/**
 * Motor de sincronización: convierte cada tema de la cola en un documento
 * de RemNote con la estructura:
 *
 *   ENARM (documento raíz)
 *     └─ GINECOLOGÍA Y OBSTETRICIA (o la especialidad del tema)
 *          └─ Control prenatal (documento del tema, creado a partir del
 *             markdown de la plantilla de Diego; las líneas
 *             "pregunta >> respuesta" se convierten en flashcards
 *             automáticamente por el parser de markdown de RemNote)
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
 * Idempotente: si el documento del tema ya existe bajo su especialidad,
 * se salta (status "ya-existia"). Nunca borra ni modifica rems existentes.
 * Solo crea lo que falta. Las flashcards son únicamente las del simulador
 * del curso, que ya vienen en el markdown; el plugin no genera ninguna.
 */

import type { RNPlugin } from '@remnote/plugin-sdk';
import type { EnarmQueue, EnarmTopic } from './queue';

export type SyncStatus = 'creado' | 'ya-existia' | 'error';

export interface SyncResult {
  date: string;
  topic: string;
  especialidad: string;
  status: SyncStatus;
  detail?: string;
}

/** Lo mínimo que el motor necesita del plugin (sirve RNPlugin y ReactRNPlugin). */
export type SyncPlugin = Pick<RNPlugin, 'rem'>;

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
      return { ...base, status: 'ya-existia', detail: 'El tema ya estaba en RemNote' };
    }
    // createTreeWithMarkdown crea el árbol del tema directamente bajo su
    // especialidad (SDK >= 0.0.20; createWithMarkdown fue eliminado).
    step = `createTreeWithMarkdown(${topic.topic})`;
    const roots = await plugin.rem.createTreeWithMarkdown(topic.markdown, specialtyId);
    if (!roots || roots.length === 0) {
      throw new Error(
        'createTreeWithMarkdown no devolvió ningún documento: revisa que la versión instalada de RemNote soporte este método',
      );
    }
    return {
      ...base,
      status: 'creado',
      detail: `Documento creado bajo su especialidad (${roots.length} raíz/raíces)`,
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
