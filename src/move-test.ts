/**
 * Prueba de mover con setParent (v0.1.5).
 *
 * Contexto: el comando "Move Bullet" de la UI duplica en vez de mover
 * (casi seguro llama a moveRems() pasando el origen como portal, y la
 * ubicación vieja conserva un portal/referencia), y cortar/pegar exige
 * el teclado del usuario (la herramienta del navegador no puede enviar
 * Ctrl+X/Ctrl+V) — Diego canceló ese método el 20 nov 2026.
 *
 * setParent(parent) es el cambio de padre crudo del modelo de datos, SIN
 * parámetro de portal (SDK 0.0.20, rem.d.ts:204), y el plugin ya lo usa
 * (sync.ts, appendRem, "método del tutorial oficial"). Este comando lo
 * prueba con UN rem desechable y reporta si mueve limpio o duplica:
 *
 *   COLOPROCTOLOGÍA → CIRUGÍA GENERAL, rem "PRUEBA-SETPARENT-2026-11-20"
 *   con un hijo "hijo de prueba".
 *
 * Veredicto:
 * - "mueve-limpio": el rem queda SOLO en CIRUGÍA GENERAL con su hijo,
 *   nada en COLOPROCTOLOGÍA, y ya se borró (limpieza automática).
 * - "duplica": el rem queda en AMBAS secciones. NO se borra nada: se
 *   deja para inspección y limpieza a mano.
 * - "inconcluso"/"error": cualquier otro estado; el detalle va en el
 *   resultado (toast + widget).
 *
 * La resolución de secciones lee el árbol (getChildrenRem + texto plano),
 * NO el índice de búsqueda: con el índice atascado, findByName no
 * encontraba rems que sí existían (origen probable de los duplicados).
 * Solo la raíz ENARM se resuelve por findByName (documento de nivel
 * superior, igual que en sync.ts).
 */

import type { RNPlugin } from '@remnote/plugin-sdk';
import { remPlainText } from './sync';

/** Lo mínimo que este módulo necesita del plugin. */
export type MoveTestPlugin = Pick<RNPlugin, 'rem'>;

/** El tipo Rem del SDK, derivado del namespace (igual que en sync.ts). */
type TestRem = NonNullable<Awaited<ReturnType<MoveTestPlugin['rem']['findByName']>>>;

const ROOT_NAME = 'ENARM';
const SOURCE_SECTION = 'COLOPROCTOLOGÍA';
const TARGET_SECTION = 'CIRUGÍA GENERAL';
const TEST_NAME = 'PRUEBA-SETPARENT-2026-11-20';
const TEST_CHILD = 'hijo de prueba';

const CREATE_REM_UNDEFINED_HINT =
  'createRem devolvió undefined: revisa que el plugin tenga permiso ReadCreateModify/All en Ajustes → Plugins';

export type MoveVerdict = 'mueve-limpio' | 'duplica' | 'inconcluso' | 'error';

export interface MoveTestResult {
  at: string;
  verdict: MoveVerdict;
  source: string;
  target: string;
  /** Nº de rems con el nombre de prueba bajo cada sección, antes del movimiento. */
  beforeSource: number;
  beforeTarget: number;
  /** Nº de rems con el nombre de prueba bajo cada sección, después del movimiento. */
  afterSource: number;
  afterTarget: number;
  /** ¿El padre del rem de prueba es la sección destino? null = no se pudo leer. */
  parentIsTarget: boolean | null;
  /** ¿El hijo de prueba sigue bajo el rem? null = no se pudo leer. */
  childIntact: boolean | null;
  /** Tipo de portal del rem tras el movimiento (si se pudo leer). */
  portalType: string | null;
  /** ¿El rem de prueba se borró al final (solo cuando mueve limpio)? */
  cleanedUp: boolean;
  /** Notas: restos de corridas anteriores, limpieza, etc. */
  notes: string[];
  error?: string;
}

/** Busca un hijo directo por texto exacto, leyendo el árbol (sin índice). */
async function findChildByText(
  plugin: MoveTestPlugin,
  parentId: string,
  name: string,
): Promise<TestRem | undefined> {
  const parent = await plugin.rem.findOne(parentId);
  if (!parent) return undefined;
  const kids = await parent.getChildrenRem();
  return kids.find((k) => remPlainText(k) === name);
}

/** Cuenta los hijos directos con un texto exacto (sin índice). */
async function countNamedChildren(
  plugin: MoveTestPlugin,
  parentId: string,
  name: string,
): Promise<number> {
  try {
    const parent = await plugin.rem.findOne(parentId);
    if (!parent) return 0;
    const kids = await parent.getChildrenRem();
    let n = 0;
    for (const kid of kids) {
      if (remPlainText(kid) === name) n++;
    }
    return n;
  } catch {
    return 0;
  }
}

/** Mueve un rem al final de los hijos de un padre (patrón appendRem de sync.ts). */
async function moveToEnd(
  plugin: MoveTestPlugin,
  remId: string,
  parentId: string,
): Promise<void> {
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

/** Crea un rem con un texto y lo cuelga al final de un padre. Devuelve el rem. */
async function createNamedRem(
  plugin: MoveTestPlugin,
  name: string,
  parentId: string,
): Promise<TestRem> {
  const created = await plugin.rem.createRem();
  if (!created) {
    throw new Error(`${CREATE_REM_UNDEFINED_HINT} (al crear "${name}")`);
  }
  await created.setText([name]);
  await moveToEnd(plugin, created._id, parentId);
  return created;
}

// ---------------------------------------------------------------------------
// Registro de pruebas (lo lee el widget, como el registro de syncs)
// ---------------------------------------------------------------------------

const MAX_LOG_ENTRIES = 5;
const moveTestLog: MoveTestResult[] = [];

/** Copia del registro de las últimas pruebas (la más reciente primero). */
export function getMoveTestLog(): MoveTestResult[] {
  return [...moveTestLog];
}

function recordResult(result: MoveTestResult): void {
  moveTestLog.unshift(result);
  if (moveTestLog.length > MAX_LOG_ENTRIES) {
    moveTestLog.length = MAX_LOG_ENTRIES;
  }
}

/**
 * Corre la prueba completa: crea el rem de prueba en la sección vieja,
 * lo mueve con setParent a la sección nueva, verifica dónde quedó y,
 * solo si mueve limpio, lo borra. Nunca toca rems reales.
 */
export async function runMoveTest(plugin: MoveTestPlugin): Promise<MoveTestResult> {
  const notes: string[] = [];
  const base: Omit<MoveTestResult, 'verdict' | 'cleanedUp'> = {
    at: new Date().toISOString(),
    source: SOURCE_SECTION,
    target: TARGET_SECTION,
    beforeSource: 0,
    beforeTarget: 0,
    afterSource: 0,
    afterTarget: 0,
    parentIsTarget: null,
    childIntact: null,
    portalType: null,
    notes,
  };
  const fail = (error: string, partial?: Partial<MoveTestResult>): MoveTestResult => {
    const result: MoveTestResult = { ...base, ...partial, verdict: 'error', cleanedUp: false, error };
    recordResult(result);
    return result;
  };

  let testRem: TestRem | undefined;
  try {
    const root = await plugin.rem.findByName([ROOT_NAME], null);
    if (!root) return fail('no existe el documento ENARM');
    const source = await findChildByText(plugin, root._id, SOURCE_SECTION);
    if (!source) return fail(`no existe la sección "${SOURCE_SECTION}" bajo ENARM`);
    const target = await findChildByText(plugin, root._id, TARGET_SECTION);
    if (!target) return fail(`no existe la sección "${TARGET_SECTION}" bajo ENARM`);

    // Restos de una corrida anterior (mismo nombre de prueba): se quitan
    // para que la prueba sea repetible. El nombre es único de esta prueba,
    // nunca contenido real.
    for (const section of [source, target]) {
      const leftover = await findChildByText(plugin, section._id, TEST_NAME);
      if (leftover) {
        await leftover.remove();
        notes.push(`se borró un rem de prueba sobrante en ${remPlainText(section)}`);
      }
    }

    base.beforeSource = await countNamedChildren(plugin, source._id, TEST_NAME);
    base.beforeTarget = await countNamedChildren(plugin, target._id, TEST_NAME);

    testRem = await createNamedRem(plugin, TEST_NAME, source._id);
    await createNamedRem(plugin, TEST_CHILD, testRem._id);

    const setupSource = await countNamedChildren(plugin, source._id, TEST_NAME);
    const setupChildren = await testRem.getChildrenRem().catch(() => []);
    if (setupSource !== 1 || setupChildren.length !== 1) {
      try {
        await testRem.remove();
      } catch {
        notes.push('no se pudo borrar el rem de prueba tras fallar la preparación');
      }
      return fail(
        `la preparación falló: ${setupSource} rem(s) de prueba en origen y ${setupChildren.length} hijo(s) (se esperaban 1 y 1)`,
        { beforeSource: base.beforeSource, beforeTarget: base.beforeTarget },
      );
    }

    await moveToEnd(plugin, testRem._id, target._id);

    base.afterSource = await countNamedChildren(plugin, source._id, TEST_NAME);
    base.afterTarget = await countNamedChildren(plugin, target._id, TEST_NAME);
    try {
      const parent = await testRem.getParentRem();
      base.parentIsTarget = !!parent && parent._id === target._id;
    } catch {
      base.parentIsTarget = null;
    }
    try {
      const kids = await testRem.getChildrenRem();
      base.childIntact = kids.length === 1 && remPlainText(kids[0]) === TEST_CHILD;
    } catch {
      base.childIntact = null;
    }
    try {
      base.portalType = String(await testRem.getPortalType());
    } catch {
      base.portalType = null;
    }

    const movedClean =
      base.afterSource === 0 &&
      base.afterTarget === 1 &&
      base.parentIsTarget === true &&
      base.childIntact === true;
    const duplicated = base.afterSource === 1 && base.afterTarget === 1;

    if (movedClean) {
      await testRem.remove();
      const afterDelete = await countNamedChildren(plugin, target._id, TEST_NAME);
      const cleanedUp = afterDelete === 0;
      if (!cleanedUp) notes.push('el rem de prueba no se pudo borrar tras mover limpio');
      const result: MoveTestResult = { ...base, verdict: 'mueve-limpio', cleanedUp };
      recordResult(result);
      return result;
    }

    if (duplicated) {
      notes.push('no se borró nada: el rem de prueba queda en ambas secciones para inspección');
      const result: MoveTestResult = { ...base, verdict: 'duplica', cleanedUp: false };
      recordResult(result);
      return result;
    }

    notes.push('no se borró nada: el rem de prueba queda donde esté para inspección');
    const result: MoveTestResult = { ...base, verdict: 'inconcluso', cleanedUp: false };
    recordResult(result);
    return result;
  } catch (error) {
    // Si el rem de prueba se creó y algo falló después, intento de
    // limpieza best-effort (solo el rem de prueba, nunca contenido real).
    if (testRem) {
      try {
        await testRem.remove();
        notes.push('se borró el rem de prueba tras el error');
      } catch {
        notes.push('no se pudo borrar el rem de prueba tras el error');
      }
    }
    return fail(error instanceof Error ? error.message : String(error));
  }
}
