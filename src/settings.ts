/**
 * Settings del plugin ENARM · Resúmenes diarios.
 * Se registran en onActivate (src/widgets/index.tsx) y se leen con
 * plugin.settings.getSetting<T>(id). El usuario puede cambiarlas en
 * RemNote → Ajustes → Plugins → ENARM · Resúmenes diarios.
 */

import type { RNPlugin } from '@remnote/plugin-sdk';

// IDs de los ajustes (estables; no cambiar una vez publicado el plugin).
export const SETTING_QUEUE_URL = 'enarm-queue-url';
export const SETTING_AUTO_SYNC = 'enarm-auto-sync';

// Valores por defecto.
export const DEFAULT_QUEUE_URL =
  'https://raw.githubusercontent.com/diegogarciaguzman/enarm-remnote-plugin/main/queue.json';
export const DEFAULT_AUTO_SYNC = true;

export interface EnarmSettings {
  queueUrl: string;
  autoSync: boolean;
}

export function getDefaultEnarmSettings(): EnarmSettings {
  return {
    queueUrl: DEFAULT_QUEUE_URL,
    autoSync: DEFAULT_AUTO_SYNC,
  };
}

export async function readEnarmSettings(
  plugin: Pick<RNPlugin, 'settings'>,
): Promise<EnarmSettings> {
  const defaults = getDefaultEnarmSettings();
  const [queueUrl, autoSync] = await Promise.all([
    plugin.settings.getSetting<string>(SETTING_QUEUE_URL),
    plugin.settings.getSetting<boolean>(SETTING_AUTO_SYNC),
  ]);
  return {
    queueUrl: typeof queueUrl === 'string' && queueUrl.trim() ? queueUrl : defaults.queueUrl,
    autoSync: typeof autoSync === 'boolean' ? autoSync : defaults.autoSync,
  };
}
