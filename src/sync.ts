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
 * NOTA DE VERSIÓN DEL SDK: la plantilla oficial fija
 * @remnote/plugin-sdk en 0.0.14. En esa versión NO existen los métodos
 * createTreeWithMarkdown / createSingleRemWithMarkdown que aparecen en
 * la documentación web (son de versiones más nuevas del SDK). Aquí se
 * usa la API real de 0.0.14: createWithMarkdown() crea el árbol y
 * moveRems() lo coloca bajo su padre. Si algún día se actualiza el SDK,
 * se puede volver a los métodos con parentId directo.
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

const ROOT_NAME = 'ENARM';

/**
 * Mueve un rem bajo un padre, al final de sus hijos (orden cronológico).
 * Si no se puede contar los hijos, cae a la posición 0.
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
  await plugin.rem.moveRems([remId], parentId, position);
}

/** Busca un rem de nivel superior por nombre exacto; si no existe, lo crea. */
async function findOrCreateTopRem(plugin: SyncPlugin, name: string): Promise<string> {
  const found = await plugin.rem.findByName([name], null);
  if (found) {
    return found._id;
  }
  const created = await plugin.rem.createRem();
  if (!created) {
    throw new Error(`No se pudo crear el rem "${name}"`);
  }
  await created.setText([name]);
  return created._id;
}

/** Busca un rem hijo por nombre exacto dentro de un padre; si no existe, lo crea. */
async function findOrCreateChildRem(
  plugin: SyncPlugin,
  name: string,
  parentId: string,
): Promise<string> {
  const found = await plugin.rem.findByName([name], parentId);
  if (found) {
    return found._id;
  }
  const created = await plugin.rem.createRem();
  if (!created) {
    throw new Error(`No se pudo crear el rem "${name}"`);
  }
  await created.setText([name]);
  await appendRem(plugin, created._id, parentId);
  return created._id;
}

export async function syncTopic(plugin: SyncPlugin, topic: EnarmTopic): Promise<SyncResult> {
  const base: Omit<SyncResult, 'status' | 'detail'> = {
    date: topic.date,
    topic: topic.topic,
    especialidad: topic.especialidad,
  };
  try {
    const rootId = await findOrCreateTopRem(plugin, ROOT_NAME);
    const specialtyId = await findOrCreateChildRem(plugin, topic.especialidad, rootId);
    const existing = await plugin.rem.findByName([topic.topic], specialtyId);
    if (existing) {
      return { ...base, status: 'ya-existia', detail: 'El tema ya estaba en RemNote' };
    }
    // createWithMarkdown crea el árbol del tema (raíz = documento del tema)
    // en la ubicación por defecto del plugin; luego se mueve bajo su especialidad.
    const root = await plugin.rem.createWithMarkdown(topic.markdown);
    if (!root) {
      return { ...base, status: 'error', detail: 'RemNote no devolvió el documento creado' };
    }
    await appendRem(plugin, root._id, specialtyId);
    return { ...base, status: 'creado', detail: 'Documento creado bajo su especialidad' };
  } catch (error) {
    return { ...base, status: 'error', detail: error instanceof Error ? error.message : String(error) };
  }
}

/** Sincroniza todos los temas de la cola, en orden, con una pausa breve entre temas. */
export async function syncAll(plugin: SyncPlugin, queue: EnarmQueue): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  for (const topic of queue.topics) {
    results.push(await syncTopic(plugin, topic));
    // Pausa breve: RemNote limita la creación de rems (~1000 rems por ~25 s).
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return results;
}
