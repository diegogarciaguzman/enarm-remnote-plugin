/**
 * Verificación y reparación de visibilidad (v0.1.4).
 *
 * Diagnóstico (18 nov 2026): las páginas individuales de los 31 documentos
 * se ven casi vacías (solo el encabezado en mayúsculas y viñetas vacías)
 * aunque el contenido está completo en el árbol del ENARM. La causa más
 * probable es que los hijos están OCULTOS en el contexto de portal de la
 * página del documento: los árboles se crearon por programa
 * (createTreeWithMarkdown) y nunca se marcaron como visibles en esa página.
 * Es un estado de visibilidad, no contenido perdido.
 *
 * Principio: primero LEER el estado (diagnóstico, solo lectura) y solo si
 * confirma `hidden`, ESCRIBIR (reveal). El reveal nunca se ejecuta
 * automáticamente desde el diagnóstico: son comandos separados.
 *
 * Este módulo también verifica el conteo de tarjetas por tema contra la
 * cola (724 `>>` en total), contando por datos (plugin.card.getAll +
 * getDescendants) en vez de por el DOM del árbol virtualizado.
 */

import type { RNPlugin } from '@remnote/plugin-sdk';
import type { EnarmQueue, EnarmTopic } from './queue';
import { remPlainText } from './sync';

/** Lo mínimo que este módulo necesita del plugin. */
export type VerifyPlugin = Pick<RNPlugin, 'rem' | 'card'>;

/** El tipo Rem del SDK, derivado del namespace (igual que en sync.ts). */
type TopicRem = NonNullable<Awaited<ReturnType<VerifyPlugin['rem']['findByName']>>>;

const ROOT_NAME = 'ENARM';

/** Caché de resolución (raíz + especialidades) dentro de una corrida. */
interface ResolveCache {
  rootId?: string;
  specialties: Map<string, string>;
}

function newResolveCache(): ResolveCache {
  return { specialties: new Map() };
}

/**
 * Resuelve el rem-documento de un tema SIN crear nada (solo lectura).
 * Devuelve el rem o el motivo por el que no se pudo resolver.
 */
async function resolveTopicDoc(
  plugin: VerifyPlugin,
  topic: EnarmTopic,
  cache: ResolveCache,
): Promise<{ rem: TopicRem } | { error: string }> {
  try {
    if (!cache.rootId) {
      const root = await plugin.rem.findByName([ROOT_NAME], null);
      if (!root) return { error: 'no existe el documento ENARM' };
      cache.rootId = root._id;
    }
    let specialtyId = cache.specialties.get(topic.especialidad);
    if (!specialtyId) {
      const spec = await plugin.rem.findByName([topic.especialidad], cache.rootId);
      if (!spec) return { error: `no existe la especialidad "${topic.especialidad}"` };
      specialtyId = spec._id;
      cache.specialties.set(topic.especialidad, specialtyId);
    }
    const doc = await plugin.rem.findByName([topic.topic], specialtyId);
    if (!doc) return { error: 'no existe el documento del tema' };
    return { rem: doc };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** Lee el estado de visibilidad de un rem en el portal de su documento. */
type VisibilityState = 'hidden' | 'included' | 'none' | 'unknown';

async function readState(rem: TopicRem, portalId: string): Promise<VisibilityState> {
  try {
    const state = await rem.getHiddenExplicitlyIncludedState(portalId);
    return state === 'hidden' || state === 'included' || state === 'none' ? state : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Lee estados en paralelo, en lotes, para no saturar al host. */
async function readStatesBatched(rems: TopicRem[], portalId: string, batchSize = 50): Promise<VisibilityState[]> {
  const out: VisibilityState[] = [];
  for (let i = 0; i < rems.length; i += batchSize) {
    const batch = rems.slice(i, i + batchSize);
    const states = await Promise.all(batch.map((r) => readState(r, portalId)));
    out.push(...states);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Diagnóstico de visibilidad (SOLO LECTURA)
// ---------------------------------------------------------------------------

export interface VisibilityRow {
  date: string;
  topic: string;
  especialidad: string;
  exists: boolean;
  isDocument?: boolean;
  docId?: string;
  /** Hijos directos del rem-documento. */
  directChildren?: number;
  /** Todos los descendientes del rem-documento. */
  descendants?: number;
  /** Conteo de estados entre los descendientes, en el portal del documento. */
  hidden: number;
  included: number;
  none: number;
  unknown: number;
  /** Hijos directos ocultos en el portal del documento ENARM (contraste). */
  directHiddenInEnarm: number | null;
  /** ¿La sección en mayúsculas es hija directa del título? null = no se encontró. */
  uppercaseUnderTitle: boolean | null;
  /** Hermanos visibles del primer hijo en el portal del documento (contraste). */
  visibleSiblings: number | null;
  error?: string;
}

export async function diagnoseVisibility(
  plugin: VerifyPlugin,
  queue: EnarmQueue,
): Promise<VisibilityRow[]> {
  const cache = newResolveCache();
  const rows: VisibilityRow[] = [];
  for (const topic of queue.topics) {
    const base: VisibilityRow = {
      date: topic.date,
      topic: topic.topic,
      especialidad: topic.especialidad,
      exists: false,
      hidden: 0,
      included: 0,
      none: 0,
      unknown: 0,
      directHiddenInEnarm: null,
      uppercaseUnderTitle: null,
      visibleSiblings: null,
    };
    const resolved = await resolveTopicDoc(plugin, topic, cache);
    if ('error' in resolved) {
      rows.push({ ...base, error: resolved.error });
      continue;
    }
    const doc = resolved.rem;
    try {
      const isDoc = await doc.isDocument();
      const children = await doc.getChildrenRem();
      const descendants = await doc.getDescendants();
      const states = await readStatesBatched(descendants, doc._id);
      let hidden = 0;
      let included = 0;
      let none = 0;
      let unknown = 0;
      for (const s of states) {
        if (s === 'hidden') hidden++;
        else if (s === 'included') included++;
        else if (s === 'none') none++;
        else unknown++;
      }
      // Contraste: ¿los hijos directos están ocultos también en el portal
      // del documento ENARM (el árbol, donde sí se ve el contenido)?
      let directHiddenInEnarm: number | null = null;
      if (cache.rootId && children.length > 0) {
        const enarmStates = await readStatesBatched(children, cache.rootId);
        directHiddenInEnarm = enarmStates.filter((s) => s === 'hidden').length;
      }
      // ¿La sección en mayúsculas es hija directa del título?
      const upperName = topic.topic.toUpperCase();
      let uppercaseUnderTitle: boolean | null = null;
      if (upperName !== topic.topic) {
        const upper = descendants.find((d) => remPlainText(d) === upperName);
        if (upper) {
          const parent = await upper.getParentRem().catch(() => undefined);
          uppercaseUnderTitle = !!parent && parent._id === doc._id;
        }
      }
      // Contraste: hermanos visibles del primer hijo en el portal del documento.
      let visibleSiblings: number | null = null;
      if (children.length > 0) {
        try {
          visibleSiblings = (await children[0].visibleSiblingRem(doc._id)).length;
        } catch {
          visibleSiblings = null;
        }
      }
      rows.push({
        ...base,
        exists: true,
        isDocument: isDoc,
        docId: doc._id,
        directChildren: children.length,
        descendants: descendants.length,
        hidden,
        included,
        none,
        unknown,
        directHiddenInEnarm,
        uppercaseUnderTitle,
        visibleSiblings,
      });
    } catch (error) {
      rows.push({
        ...base,
        exists: true,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Reveal (ESCRIBE visibilidad, solo dentro del subárbol del tema)
// ---------------------------------------------------------------------------

export interface RevealRow {
  date: string;
  topic: string;
  especialidad: string;
  exists: boolean;
  /** Descendientes que estaban hidden y se marcaron included. */
  revealed: number;
  /** Descendientes totales revisados. */
  total: number;
  /** Descendientes cuyo estado no se pudo leer (no se tocaron). */
  unknown: number;
  /** ¿Se pudo expandir el documento al terminar? */
  expandOk: boolean;
  error?: string;
}

export async function revealContent(plugin: VerifyPlugin, queue: EnarmQueue): Promise<RevealRow[]> {
  const cache = newResolveCache();
  const rows: RevealRow[] = [];
  for (const topic of queue.topics) {
    const base: RevealRow = {
      date: topic.date,
      topic: topic.topic,
      especialidad: topic.especialidad,
      exists: false,
      revealed: 0,
      total: 0,
      unknown: 0,
      expandOk: false,
    };
    const resolved = await resolveTopicDoc(plugin, topic, cache);
    if ('error' in resolved) {
      rows.push({ ...base, error: resolved.error });
      continue;
    }
    const doc = resolved.rem;
    try {
      const descendants = await doc.getDescendants();
      let revealed = 0;
      let unknown = 0;
      // Se lee el estado de cada descendiente y solo se escribe sobre los
      // que están 'hidden' en el portal del documento. Idempotente: una
      // segunda corrida encuentra todo 'included' y no toca nada.
      for (let i = 0; i < descendants.length; i += 50) {
        const batch = descendants.slice(i, i + 50);
        const states = await Promise.all(
          batch.map((d) => readState(d, doc._id)),
        );
        const toReveal = batch.filter((_, j) => states[j] === 'hidden');
        unknown += states.filter((s) => s === 'unknown').length;
        for (const rem of toReveal) {
          await rem.setHiddenExplicitlyIncludedState('included', doc._id);
          revealed++;
        }
      }
      let expandOk = false;
      try {
        await doc.expand(doc, true);
        expandOk = true;
      } catch {
        expandOk = false;
      }
      rows.push({ ...base, exists: true, revealed, total: descendants.length, unknown, expandOk });
    } catch (error) {
      rows.push({
        ...base,
        exists: true,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Verificación de tarjetas por tema (SOLO LECTURA)
// ---------------------------------------------------------------------------

export type CardCheckStatus = 'exacto' | 'corto' | 'de más' | 'error';

export interface CardCheckRow {
  date: string;
  topic: string;
  especialidad: string;
  /** Nº de `>>` en el markdown de la cola (lo que debe haber). */
  expected: number;
  /** Nº de tarjetas reales en el subárbol del tema (getAll + getDescendants). */
  actual: number | null;
  status: CardCheckStatus;
  /** Contraste (getCards() en la sección Flashcards): puede ser null si no aplica. */
  contrast: number | null;
  error?: string;
}

export interface CardCheckResult {
  rows: CardCheckRow[];
  totalExpected: number;
  totalActual: number;
  exact: number;
  short: number;
  extra: number;
}

/** Nº de tarjetas esperadas de un tema: nº de `>>` en su markdown (sin solapar). */
export function expectedCardCount(topic: EnarmTopic): number {
  return (topic.markdown.match(/>>/g) ?? []).length;
}

export async function verifyCards(
  plugin: VerifyPlugin,
  queue: EnarmQueue,
): Promise<CardCheckResult> {
  const cache = newResolveCache();
  // Una sola llamada: todas las tarjetas de la base, mapeadas por remId.
  const allCards = await plugin.card.getAll();
  const byRemId = new Map<string, number>();
  for (const card of allCards) {
    byRemId.set(card.remId, (byRemId.get(card.remId) ?? 0) + 1);
  }
  const rows: CardCheckRow[] = [];
  let totalExpected = 0;
  let totalActual = 0;
  let exact = 0;
  let short = 0;
  let extra = 0;
  for (const topic of queue.topics) {
    const expected = expectedCardCount(topic);
    totalExpected += expected;
    const base: CardCheckRow = {
      date: topic.date,
      topic: topic.topic,
      especialidad: topic.especialidad,
      expected,
      actual: null,
      status: 'error',
      contrast: null,
    };
    const resolved = await resolveTopicDoc(plugin, topic, cache);
    if ('error' in resolved) {
      rows.push({ ...base, error: resolved.error });
      continue;
    }
    const doc = resolved.rem;
    try {
      const descendants = await doc.getDescendants();
      const subtree = new Set<string>([doc._id]);
      for (const d of descendants) subtree.add(d._id);
      let actual = 0;
      for (const [remId, n] of byRemId) {
        if (subtree.has(remId)) actual += n;
      }
      totalActual += actual;
      const status: CardCheckStatus =
        actual === expected ? 'exacto' : actual < expected ? 'corto' : 'de más';
      if (status === 'exacto') exact++;
      else if (status === 'corto') short++;
      else extra++;
      // Contraste: getCards() en la sección Flashcards real (la que está
      // bajo la sección en mayúsculas, no la viñeta "- Flashcards." bajo
      // "Puntos de oro"). Si hay varias con ese texto, se toma la que
      // devuelva más tarjetas. Su semántica no aclara si incluye el
      // subárbol, así que es solo contraste, no el método primario.
      let contrast: number | null = null;
      try {
        const candidates = descendants.filter((d) => remPlainText(d) === 'Flashcards.');
        let best = 0;
        let sawAny = false;
        for (const c of candidates) {
          const cards = await c.getCards();
          sawAny = true;
          if (cards.length > best) best = cards.length;
        }
        contrast = sawAny ? best : null;
      } catch {
        contrast = null;
      }
      rows.push({ ...base, actual, status, contrast });
    } catch (error) {
      rows.push({
        ...base,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { rows, totalExpected, totalActual, exact, short, extra };
}
