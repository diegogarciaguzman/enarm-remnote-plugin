import { declareIndexPlugin, type ReactRNPlugin, WidgetLocation } from '@remnote/plugin-sdk';
import '../style.css';
import '../index.css'; // import <widget-name>.css
import {
  DEFAULT_AUTO_SYNC,
  DEFAULT_QUEUE_URL,
  SETTING_AUTO_SYNC,
  SETTING_QUEUE_URL,
  readEnarmSettings,
} from '../settings';
import { fetchQueue, type EnarmQueue } from '../queue';
import { runSyncAllOnce } from '../sync';
import { diagnoseVisibility, revealContent, verifyCards } from '../verify';

/** Descarga la cola de resúmenes (misma fuente para sync y verificaciones). */
async function loadQueue(plugin: ReactRNPlugin): Promise<EnarmQueue> {
  const settings = await readEnarmSettings(plugin);
  return fetchQueue(settings.queueUrl);
}

/** El plugin necesita acceso a los documentos; sin él nada de esto funciona. */
function hasRemAccess(plugin: ReactRNPlugin): boolean {
  return !!plugin.rem;
}

async function noAccessToast(plugin: ReactRNPlugin): Promise<void> {
  await plugin.app.toast(
    'ENARM: RemNote no entregó acceso a los documentos (plugin.rem vacío). Revisa los permisos del plugin en Ajustes → Plugins y reinstala el ZIP aceptando todos los permisos.',
  );
}

/** Descarga la cola y mete en RemNote los temas que falten. Muestra un toast con el resumen. */
async function runSync(plugin: ReactRNPlugin): Promise<void> {
  if (!hasRemAccess(plugin)) {
    await noAccessToast(plugin);
    return;
  }
  try {
    const queue = await loadQueue(plugin);
    const { ran, results } = await runSyncAllOnce(plugin, queue);
    if (!ran || !results) {
      await plugin.app.toast('ENARM: ya hay una sincronización en curso, espera a que termine.');
      return;
    }
    const created = results.filter((r) => r.status === 'creado').length;
    const converted = results.filter((r) => r.status === 'convertido').length;
    const skipped = results.filter((r) => r.status === 'ya-existia').length;
    const errors = results.filter((r) => r.status === 'error');
    // El detalle del primer error va en el propio aviso: es el único canal
    // que siempre se ve (el widget no siempre aparece en la barra lateral).
    // El detalle de TODOS los errores queda en el registro del widget.
    const firstError = errors[0];
    await plugin.app.toast(
      `ENARM: ${created} tema(s) creado(s), ${converted} convertido(s) a documento, ${skipped} ya estaban, ${errors.length} con error.` +
        (firstError
          ? ` Primer error (${firstError.date} ${firstError.topic}): ${firstError.detail ?? 'sin detalle'}.`
          : ''),
    );
  } catch (error) {
    await plugin.app.toast(
      `ENARM: no se pudo sincronizar: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Diagnóstico de visibilidad (SOLO LECTURA, v0.1.4): lee el estado de los
 * hijos de cada documento en el portal de su página. No escribe nada.
 * El resultado detallado queda en el widget; aquí solo va el resumen.
 */
async function runDiagnoseVisibility(plugin: ReactRNPlugin): Promise<void> {
  if (!hasRemAccess(plugin)) {
    await noAccessToast(plugin);
    return;
  }
  try {
    const queue = await loadQueue(plugin);
    const rows = await diagnoseVisibility(plugin, queue);
    const withHidden = rows.filter((r) => r.hidden > 0).length;
    const clean = rows.filter((r) => r.exists && r.hidden === 0).length;
    const errors = rows.filter((r) => r.error).length;
    await plugin.app.toast(
      `ENARM: visibilidad — ${withHidden}/31 temas con hijos ocultos en su página, ${clean} sin ocultos, ${errors} con error. Detalle en el widget.`,
    );
  } catch (error) {
    await plugin.app.toast(
      `ENARM: no se pudo diagnosticar la visibilidad: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Reveal (v0.1.4): marca como incluidos los hijos ocultos de cada documento
 * y expande el documento. NO se ejecuta desde el diagnóstico: el usuario
 * corre primero el diagnóstico y luego este comando, si confirma ocultos.
 */
async function runRevealContent(plugin: ReactRNPlugin): Promise<void> {
  if (!hasRemAccess(plugin)) {
    await noAccessToast(plugin);
    return;
  }
  try {
    const queue = await loadQueue(plugin);
    const rows = await revealContent(plugin, queue);
    const revealed = rows.reduce((n, r) => n + r.revealed, 0);
    const topics = rows.filter((r) => r.revealed > 0).length;
    const errors = rows.filter((r) => r.error).length;
    await plugin.app.toast(
      `ENARM: reveal — ${revealed} hijo(s) revelado(s) en ${topics} tema(s), ${errors} con error. Detalle en el widget.`,
    );
  } catch (error) {
    await plugin.app.toast(
      `ENARM: no se pudo revelar el contenido: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Verificación de tarjetas por tema (SOLO LECTURA, v0.1.4): cuenta las
 * tarjetas reales por subárbol y las compara con los `>>` de la cola.
 */
async function runVerifyCards(plugin: ReactRNPlugin): Promise<void> {
  if (!hasRemAccess(plugin) || !plugin.card) {
    await noAccessToast(plugin);
    return;
  }
  try {
    const queue = await loadQueue(plugin);
    const result = await verifyCards(plugin, queue);
    await plugin.app.toast(
      `ENARM: tarjetas — ${result.exact}/31 exactos, ${result.short} cortos, ${result.extra} de más. Total real ${result.totalActual}/${result.totalExpected} esperadas. Detalle en el widget.`,
    );
  } catch (error) {
    await plugin.app.toast(
      `ENARM: no se pudieron verificar las tarjetas: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function onActivate(plugin: ReactRNPlugin) {
  // Ajustes: URL de la cola y auto-sync al abrir RemNote.
  await plugin.settings.registerStringSetting({
    id: SETTING_QUEUE_URL,
    title: 'URL de la cola de resúmenes ENARM',
    defaultValue: DEFAULT_QUEUE_URL,
  });

  await plugin.settings.registerBooleanSetting({
    id: SETTING_AUTO_SYNC,
    title: 'Sincronizar automáticamente al abrir RemNote',
    defaultValue: DEFAULT_AUTO_SYNC,
  });

  // Comando en la paleta (Ctrl/Cmd+K): ENARM: sincronizar resúmenes ahora.
  await plugin.app.registerCommand({
    id: 'enarm-sync-now',
    name: 'ENARM: sincronizar resúmenes ahora',
    action: async () => {
      await runSync(plugin);
    },
  });

  // v0.1.4: diagnóstico de visibilidad (solo lectura).
  await plugin.app.registerCommand({
    id: 'enarm-diagnose-visibility',
    name: 'ENARM: diagnosticar visibilidad de documentos',
    action: async () => {
      await runDiagnoseVisibility(plugin);
    },
  });

  // v0.1.4: reveal (solo si el diagnóstico confirma hijos ocultos).
  await plugin.app.registerCommand({
    id: 'enarm-reveal-content',
    name: 'ENARM: revelar contenido de documentos',
    action: async () => {
      await runRevealContent(plugin);
    },
  });

  // v0.1.4: verificación de tarjetas por tema (solo lectura).
  await plugin.app.registerCommand({
    id: 'enarm-verify-cards',
    name: 'ENARM: verificar tarjetas por tema',
    action: async () => {
      await runVerifyCards(plugin);
    },
  });

  // Widget en la barra lateral derecha con el botón de sincronizar.
  await plugin.app.registerWidget('enarm_sync', WidgetLocation.RightSidebar, {
    dimensions: { height: 'auto', width: '100%' },
  });

  // Auto-sync al abrir RemNote (con una pausa para que la app termine de cargar).
  const settings = await readEnarmSettings(plugin);
  if (settings.autoSync) {
    setTimeout(() => void runSync(plugin), 5000);
  }
}

async function onDeactivate(_: ReactRNPlugin) {}

declareIndexPlugin(onActivate, onDeactivate);
