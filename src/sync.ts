/**
 * Motor de sincronización: convierte cada tema de la cola en un documento
 * INDEPENDIENTE de RemNote, dentro de su carpeta de especialidad:
 *
 *   ENARM (documento raíz)
 *     └─ GINECOLOGÍA Y OBSTETRICIA (o la especialidad del tema)
 *          └─ Control prenatal (DOCUMENTO del tema: se abre solo, aparece
 *             en la barra lateral; su contenido es el markdown de la
 *             plantilla de Diego; las líneas "pregunta >> respuesta" se
 *             convierten en flashcards automáticamente por el parser de
 *             markdown de RemNote)
 *
 * NOTA DE VERSIÓN DEL SDK (v0.1.2): la plantilla fijaba
 * @remnote/plugin-sdk en 0.0.14, donde el árbol del tema se creaba con
 * createWithMarkdown(). RemNote ELIMINÓ ese método en el SDK 0.0.20
 * (cambio breaking del changelog oficial) y el host actual (1.30.x) ya no
 * lo implementa: por eso todos los temas fallaban con "31 con error"
 * aunque createRem sí funcionaba (las carpetas de especialidad sí se
 * creaban, vacías). Desde 0.1.2 el SDK es 0.0.20 y el árbol se crea con
 * createTreeWithMarkdown(markdown, parentId), que lo deja directamente
 * bajo su especialidad; los movimientos usan Rem.setParent() (método del
 * tutorial oficial) en vez de moveRems().
 *
 * v0.1.3 — DOCUMENTOS INDEPENDIENTES (Diego, 18 nov 2026): antes, el rem
 * raíz del tema quedaba como una viñeta anidada dentro del documento ENARM
 * ("está todo suelto así"). Ahora cada tema es su propio documento: el
 * flag se pone con Rem.setIsDocument(true) (SDK 0.0.20), que marca el rem
 * como documento SIN moverlo, sin cambiar su ID, sus hijos ni sus
 * tarjetas. Los 31 temas que ya existen anidados se promueven en su lugar
 * (status "convertido"); los nuevos se crean y se promueven en el mismo
 * sync (status "creado"). La promoción no borra ni duplica nada: el árbol
 * viejo ES el documento nuevo.
 *
 * Idempotente: si el documento del tema ya existe bajo su especialidad,
 * se salta (status "ya-existia"). Nunca borra ni modifica rems existentes
 * salvo el flag de documento del propio tema. Solo crea lo que falta. Las
 * flashcards son únicamente las del simulador del curso, que ya vienen en
 * el markdown; el plugin no genera ninguna.
 */

import type { RNPlugin } from '@remnote/plugin-sdk';
import type { EnarmQueue, EnarmTopic } from './queue';

export type SyncStatus = 'creado' | 'convertido' | 'ya-existia' | 'error';

export interface SyncResult {
  date: string;
  topic: string;
  especialidad: string;
  status: SyncStatus;
  detail?: string;
}

/** Lo mínimo que el motor necesita del plugin (sirve RNPlugin y ReactRNPlugin). */
export type SyncPlugin = Pick<RNPlugin, 'rem'>;

/** El tipo Rem del SDK, derivado del namespace (evita depender de su exportación). */
type TopicRem = NonNullable<Awaited<ReturnType<SyncPlugin['rem']['findByName']>>>;

/** Contexto compartido por un sync completo: evita repetir findByName('ENARM') por tema. */
export interface SyncContext {
  rootId: string;
  specialties: Map<string, string>;
}

const ROOT_NAME = 'ENARM';

/** Mensaje cuando createRem() no devuelve nada: casi seguro falta el permiso de creación. */
const CREATE_REM_UNDEFINED_HINT =
  'createRem devolvió undefined: revisa que el plugin tenga permiso ReadCreateModify/All en Ajustes → Plugins';

type StepReporter = (step: string) => void;
const noopStep: StepReporter = () => {};

/**
 * Mueve un rem bajo un padre, al final de sus hijos (orden cronológico).
 * Usa Rem.setParent() (método del tutorial oficial). Si no se puede
 * contar los hijos, cae a la posición 0.
 */
async function appendRem(plugin: SyncPlugin, remId: string, parentId: string): Promise<void> {
  let position = 0;
  try {
    const parent = await plugin.rem.findOne(parentId);
    if (parent) {
      position = (await parent.getChildrenRem()).length;
    }
  } catch {
    position = 0;
  }
  const rem = await plugin.rem.findOne(remId);
  if (!rem) {
    throw new Error(`setParent: no se encontró el rem ${remId} para moverlo bajo ${parentId}`);
  }
  await rem.setParent(parentId, position);
}

/** Texto plano de un rem (partes string y el `.text` de los elementos). */
function remPlainText(rem: TopicRem): string {
  const parts: unknown = (rem as { text?: unknown }).text;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((p) => {
      if (typeof p === 'string') return p;
      if (p && typeof p === 'object' && 'text' in p && typeof (p as { text: unknown }).text === 'string') {
        return (p as { text: string }).text;
      }
      return '';
    })
    .join('');
}

/**
 * Marca un rem como documento independiente y verifica que el flag quedó.
 * No mueve el rem ni toca sus hijos ni sus tarjetas.
 */
async function promoteToDocument(rem: TopicRem, onStep: StepReporter): Promise<void> {
  onStep('setIsDocument(true)');
  await rem.setIsDocument(true);
  onStep('isDocument()');
  if (!(await rem.isDocument())) {
    throw new Error('setIsDocument(true) no dejó el flag: isDocument() sigue en false');
  }
}

/**
 * Contingencia del segundo `#` del markdown: si el parser dejó la sección
 * en mayúsculas (`# TEMA EN MAYÚSCULAS`) como raíz hermana del título
 * (hija directa de la especialidad) en vez de anidarla bajo él, se mueve
 * bajo el título para que el documento contenga el tema completo. Si ya
 * está anidada (lo normal según la verificación del 15 nov y la captura de
 * Diego), no hace nada. Devuelve una nota si movió algo.
 */
async function ensureUppercaseSectionInside(
  plugin: SyncPlugin,
  titleRem: TopicRem,
  specialtyId: string,
  topic: EnarmTopic,
  onStep: StepReporter,
): Promise<string | undefined> {
  const upperName = topic.topic.toUpperCase();
  if (upperName === topic.topic) return undefined;
  onStep(`findByName(${upperName}, especialidad)`);
  const upper = await plugin.rem.findByName([upperName], specialtyId);
  if (!upper) return undefined;
  const parent = await upper.getParentRem().catch(() => undefined);
  if (!parent || parent._id !== specialtyId) return undefined; // ya anidada bajo el título
  onStep(`setParent(${upperName} → título)`);
  const siblings = await titleRem.getChildrenRem().catch(() => []);
  await upper.setParent(titleRem._id, siblings.length);
  return 'sección en mayúsculas movida bajo el título';
}

/** Busca un rem de nivel superior por nombre exacto; si no existe, lo crea. */
async function findOrCreateTopRem(
  plugin: SyncPlugin,
  name: string,
  onStep: StepReporter = noopStep,
): Promise<string> {
  onStep(`findByName(${name}, null)`);
  const found = await plugin.rem.findByName([name], null);
  if (found) {
    return found._id;
  }
  onStep(`createRem(${name})`);
  const created = await plugin.rem.createRem();
  if (!created) {
    throw new Error(`${CREATE_REM_UNDEFINED_HINT} (al crear "${name}")`);
  }
  onStep(`setText(${name})`);
  await created.setText([name]);
  return created._id;
}

/** Busca un rem hijo por nombre exacto dentro de un padre; si no existe, lo crea. */
async function findOrCreateChildRem(
  plugin: SyncPlugin,
  name: string,
  parentId: string,
  onStep: StepReporter = noopStep,
): Promise<string> {
  onStep(`findByName(${name}, padre)`);
  const found = await plugin.rem.findByName([name], parentId);
  if (found) {
    return found._id;
  }
  onStep(`createRem(${name})`);
  const created = await plugin.rem.createRem();
  if (!created) {
    throw new Error(`${CREATE_REM_UNDEFINED_HINT} (al crear "${name}")`);
  }
  onStep(`setText(${name})`);
  await created.setText([name]);
  onStep(`setParent(${name} → padre)`);
  await appendRem(plugin, created._id, parentId);
  return created._id;
}

export async function syncTopic(
  plugin: SyncPlugin,
  topic: EnarmTopic,
  ctx?: SyncContext,
): Promise<SyncResult> {
  const base: Omit<SyncResult, 'status' | 'detail'> = {
    date: topic.date,
    topic: topic.topic,
    especialidad: topic.especialidad,
  };
  let step = 'inicio';
  const onStep: StepReporter = (s) => {
    step = s;
  };
  try {
    const rootId = ctx ? ctx.rootId : await findOrCreateTopRem(plugin, ROOT_NAME, onStep);
    let specialtyId = ctx?.specialties.get(topic.especialidad);
    if (!specialtyId) {
      specialtyId = await findOrCreateChildRem(plugin, topic.especialidad, rootId, onStep);
      ctx?.specialties.set(topic.especialidad, specialtyId);
    }
    step = `findByName(${topic.topic}, especialidad)`;
    const existing = await plugin.rem.findByName([topic.topic], specialtyId);
    if (existing) {
      // El tema ya existe anidado: se promueve a documento independiente
      // en su lugar (mismo rem, mismos hijos, mismas tarjetas).
      step = 'isDocument()';
      if (await existing.isDocument()) {
        return { ...base, status: 'ya-existia', detail: 'El tema ya era un documento independiente' };
      }
      await promoteToDocument(existing, onStep);
      const note = await ensureUppercaseSectionInside(plugin, existing, specialtyId, topic, onStep);
      return {
        ...base,
        status: 'convertido',
        detail: `Tema anidado promovido a documento independiente${note ? ` (${note})` : ''}`,
      };
    }
    // No existe: se crea el árbol y su raíz se marca como documento.
    // createTreeWithMarkdown crea el árbol del tema directamente bajo su
    // especialidad (SDK >= 0.0.20; createWithMarkdown fue eliminado).
    step = `createTreeWithMarkdown(${topic.topic})`;
    const roots = await plugin.rem.createTreeWithMarkdown(topic.markdown, specialtyId);
    if (!roots || roots.length === 0) {
      throw new Error(
        'createTreeWithMarkdown no devolvió ningún documento: revisa que la versión instalada de RemNote soporte este método',
      );
    }
    let titleRem = roots.find((r) => remPlainText(r) === topic.topic);
    if (!titleRem) {
      step = `findByName(${topic.topic}, especialidad) tras crear`;
      titleRem = (await plugin.rem.findByName([topic.topic], specialtyId)) ?? undefined;
    }
    if (!titleRem) {
      throw new Error(
        `createTreeWithMarkdown creó ${roots.length} raíz/raíces pero ninguna se llama "${topic.topic}"`,
      );
    }
    await promoteToDocument(titleRem, onStep);
    const note = await ensureUppercaseSectionInside(plugin, titleRem, specialtyId, topic, onStep);
    return {
      ...base,
      status: 'creado',
      detail: `Documento independiente creado bajo su especialidad${note ? ` (${note})` : ''}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const detail = `[${step}] ${message}`;
    console.error('[ENARM sync]', topic.date, topic.topic, 'paso:', step, 'error:', message);
    return { ...base, status: 'error', detail };
  }
}

/** Sincroniza todos los temas de la cola, en orden, con una pausa breve entre temas. */
export async function syncAll(plugin: SyncPlugin, queue: EnarmQueue): Promise<SyncResult[]> {
  // La raíz se resuelve una sola vez y se comparte con todos los temas.
  let ctx: SyncContext;
  try {
    const rootId = await findOrCreateTopRem(plugin, ROOT_NAME);
    ctx = { rootId, specialties: new Map() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[ENARM sync] no se pudo resolver la raíz ENARM:', message);
    throw new Error(`[findOrCreateTopRem(ENARM)] ${message}`);
  }
  const results: SyncResult[] = [];
  for (const topic of queue.topics) {
    results.push(await syncTopic(plugin, topic, ctx));
    // Pausa breve: RemNote limita la creación de rems (~1000 rems por ~25 s).
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return results;
}
