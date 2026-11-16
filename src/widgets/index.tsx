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
import { fetchQueue } from '../queue';
import { syncAll } from '../sync';

/** Descarga la cola y mete en RemNote los temas que falten. Muestra un toast con el resumen. */
async function runSync(plugin: ReactRNPlugin): Promise<void> {
  if (!plugin.rem) {
    await plugin.app.toast(
      'ENARM: RemNote no entregó acceso a los documentos (plugin.rem vacío). Revisa los permisos del plugin en Ajustes → Plugins y reinstala el ZIP aceptando todos los permisos.',
    );
    return;
  }
  try {
    const settings = await readEnarmSettings(plugin);
    const queue = await fetchQueue(settings.queueUrl);
    const results = await syncAll(plugin, queue);
    const created = results.filter((r) => r.status === 'creado').length;
    const skipped = results.filter((r) => r.status === 'ya-existia').length;
    const errors = results.filter((r) => r.status === 'error');
    // El detalle del primer error va en el propio aviso: es el único canal
    // que siempre se ve (el widget no siempre aparece en la barra lateral).
    const firstError = errors[0];
    await plugin.app.toast(
      `ENARM: ${created} tema(s) creado(s), ${skipped} ya estaban, ${errors.length} con error.` +
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
