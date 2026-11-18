import { usePlugin, renderWidget, useTracker } from '@remnote/plugin-sdk';
import { useRef, useState } from 'react';
import { SETTING_AUTO_SYNC, SETTING_QUEUE_URL, readEnarmSettings } from '../settings';
import { fetchQueue } from '../queue';
import { syncAll, type SyncResult } from '../sync';

export const EnarmSyncWidget = () => {
  const plugin = usePlugin();

  const queueUrl = useTracker(() => plugin.settings.getSetting<string>(SETTING_QUEUE_URL));
  const autoSync = useTracker(() => plugin.settings.getSetting<boolean>(SETTING_AUTO_SYNC));

  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<SyncResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const runningRef = useRef(false);

  const run = async () => {
    if (runningRef.current) {
      return;
    }
    runningRef.current = true;
    setRunning(true);
    setError(null);
    try {
      const settings = await readEnarmSettings(plugin);
      const queue = await fetchQueue(settings.queueUrl);
      const res = await syncAll(plugin, queue);
      setResults(res);
      setLastSync(new Date().toLocaleString('es-MX'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      runningRef.current = false;
    }
  };

  const created = results?.filter((r) => r.status === 'creado') ?? [];
  const converted = results?.filter((r) => r.status === 'convertido') ?? [];
  const skipped = results?.filter((r) => r.status === 'ya-existia') ?? [];
  const failed = results?.filter((r) => r.status === 'error') ?? [];

  return (
    <div className="p-2 m-2 rounded-lg rn-clr-background-light-positive rn-clr-content-positive">
      <h1 className="text-xl">ENARM · Resúmenes</h1>
      <div className="text-sm">Auto-sync al abrir: {autoSync ? 'sí' : 'no'}</div>
      <div className="text-sm break-all">Cola: {queueUrl}</div>
      <button
        className="mt-2 px-3 py-1 rounded bg-blue-600 text-white disabled:opacity-50"
        onClick={() => void run()}
        disabled={running}
      >
        {running ? 'Sincronizando…' : 'Sincronizar ahora'}
      </button>
      {error && <div className="mt-2 text-sm text-red-600">Error: {error}</div>}
      {results && (
        <div className="mt-2 text-sm">
          <div>
            Creados: {created.length} · Convertidos: {converted.length} · Ya estaban: {skipped.length} · Errores: {failed.length}
          </div>
          <ul className="mt-1">
            {results.map((r) => (
              <li key={`${r.date}-${r.topic}`}>
                {r.date} — {r.topic} ({r.especialidad}):{' '}
                {r.status === 'creado' ? 'creado' : r.status === 'convertido' ? 'convertido a documento' : r.status === 'ya-existia' ? 'ya estaba' : `error: ${r.detail ?? ''}`}
              </li>
            ))}
          </ul>
        </div>
      )}
      {lastSync && <div className="mt-2 text-xs">Última sync: {lastSync}</div>}
    </div>
  );
};

renderWidget(EnarmSyncWidget);
