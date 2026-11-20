import { usePlugin, renderWidget, useTracker } from '@remnote/plugin-sdk';
import { useEffect, useRef, useState } from 'react';
import { SETTING_AUTO_SYNC, SETTING_QUEUE_URL, readEnarmSettings } from '../settings';
import { fetchQueue } from '../queue';
import { getSyncLog, runSyncAllOnce, type SyncLogEntry, type SyncResult } from '../sync';
import {
  diagnoseVisibility,
  revealContent,
  verifyCards,
  type CardCheckResult,
  type RevealRow,
  type VisibilityRow,
} from '../verify';
import { getMoveTestLog, runMoveTest, type MoveTestResult } from '../move-test';

type BusyAction = 'sync' | 'diagnose' | 'reveal' | 'cards' | 'movetest' | null;

export const EnarmSyncWidget = () => {
  const plugin = usePlugin();

  const queueUrl = useTracker(() => plugin.settings.getSetting<string>(SETTING_QUEUE_URL));
  const autoSync = useTracker(() => plugin.settings.getSetting<boolean>(SETTING_AUTO_SYNC));

  const [busy, setBusy] = useState<BusyAction>(null);
  const [results, setResults] = useState<SyncResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [log, setLog] = useState<SyncLogEntry[]>(() => getSyncLog());
  const [visResults, setVisResults] = useState<VisibilityRow[] | null>(null);
  const [revealResults, setRevealResults] = useState<RevealRow[] | null>(null);
  const [cardResults, setCardResults] = useState<CardCheckResult | null>(null);
  const [moveResults, setMoveResults] = useState<MoveTestResult[]>(() => getMoveTestLog());
  const runningRef = useRef(false);

  // El registro se actualiza también cuando el sync corre desde el comando
  // o el auto-sync (no solo desde este botón).
  useEffect(() => {
    const id = setInterval(() => setLog(getSyncLog()), 10000);
    return () => clearInterval(id);
  }, []);

  const run = async () => {
    if (runningRef.current) {
      return;
    }
    runningRef.current = true;
    setBusy('sync');
    setError(null);
    try {
      const settings = await readEnarmSettings(plugin);
      const queue = await fetchQueue(settings.queueUrl);
      const { ran, results: res } = await runSyncAllOnce(plugin, queue);
      if (!ran || !res) {
        setError('Ya hay una sincronización en curso, espera a que termine.');
        return;
      }
      setResults(res);
      setLastSync(new Date().toLocaleString('es-MX'));
      setLog(getSyncLog());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      runningRef.current = false;
    }
  };

  const runDiagnose = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setBusy('diagnose');
    setError(null);
    try {
      const settings = await readEnarmSettings(plugin);
      const queue = await fetchQueue(settings.queueUrl);
      setVisResults(await diagnoseVisibility(plugin, queue));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      runningRef.current = false;
    }
  };

  const runReveal = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setBusy('reveal');
    setError(null);
    try {
      const settings = await readEnarmSettings(plugin);
      const queue = await fetchQueue(settings.queueUrl);
      setRevealResults(await revealContent(plugin, queue));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      runningRef.current = false;
    }
  };

  const runCards = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setBusy('cards');
    setError(null);
    try {
      const settings = await readEnarmSettings(plugin);
      const queue = await fetchQueue(settings.queueUrl);
      setCardResults(await verifyCards(plugin, queue));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      runningRef.current = false;
    }
  };

  const runMove = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setBusy('movetest');
    setError(null);
    try {
      await runMoveTest(plugin);
      setMoveResults(getMoveTestLog());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      runningRef.current = false;
    }
  };

  const created = results?.filter((r) => r.status === 'creado') ?? [];
  const converted = results?.filter((r) => r.status === 'convertido') ?? [];
  const skipped = results?.filter((r) => r.status === 'ya-existia') ?? [];
  const failed = results?.filter((r) => r.status === 'error') ?? [];

  const visHidden = visResults?.filter((r) => r.hidden > 0).length ?? 0;
  const revealTotal = revealResults?.reduce((n, r) => n + r.revealed, 0) ?? 0;

  const btnClass = 'mt-2 px-3 py-1 rounded bg-blue-600 text-white disabled:opacity-50';
  const btnClassGreen = 'mt-2 px-3 py-1 rounded bg-green-700 text-white disabled:opacity-50';

  return (
    <div className="p-2 m-2 rounded-lg rn-clr-background-light-positive rn-clr-content-positive">
      <h1 className="text-xl">ENARM · Resúmenes</h1>
      <div className="text-sm">Auto-sync al abrir: {autoSync ? 'sí' : 'no'}</div>
      <div className="text-sm break-all">Cola: {queueUrl}</div>
      <button className={btnClass} onClick={() => void run()} disabled={busy !== null}>
        {busy === 'sync' ? 'Sincronizando…' : 'Sincronizar ahora'}
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
                {r.status !== 'error' && r.detail ? ` — ${r.detail}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      {lastSync && <div className="mt-2 text-xs">Última sync: {lastSync}</div>}

      {log.length > 0 && (
        <div className="mt-3 text-sm">
          <h2 className="font-bold">Registro de syncs</h2>
          <ul className="mt-1 text-xs">
            {log.map((entry) => (
              <li key={entry.at}>
                {new Date(entry.at).toLocaleString('es-MX')}: creados {entry.created} · convertidos{' '}
                {entry.converted} · ya estaban {entry.skipped} · errores {entry.errors.length}
                {entry.errors.map((e) => (
                  <div key={`${entry.at}-${e.date}-${e.topic}`} className="text-red-600">
                    {e.date} {e.topic}: {e.detail ?? 'sin detalle'}
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 text-sm">
        <h2 className="font-bold">Visibilidad de documentos (v0.1.4)</h2>
        <div className="text-xs">
          Las páginas se ven casi vacías porque los hijos están ocultos en la vista de la página.
          Primero diagnostica (solo lectura); revela solo si hay ocultos.
        </div>
        <button className={btnClass} onClick={() => void runDiagnose()} disabled={busy !== null}>
          {busy === 'diagnose' ? 'Diagnosticando…' : 'Diagnosticar visibilidad'}
        </button>{' '}
        <button className={btnClassGreen} onClick={() => void runReveal()} disabled={busy !== null}>
          {busy === 'reveal' ? 'Revelando…' : 'Revelar contenido'}
        </button>
        {visResults && (
          <div className="mt-2 text-xs">
            <div>
              Temas con hijos ocultos: {visHidden}/{visResults.length}
            </div>
            <table className="mt-1 w-full">
              <thead>
                <tr>
                  <th className="text-left">Tema</th>
                  <th className="text-right">Ocultos</th>
                  <th className="text-right">Incluidos</th>
                  <th className="text-right">Sin estado</th>
                  <th className="text-left">Sección MAY. bajo título</th>
                </tr>
              </thead>
              <tbody>
                {visResults.map((r) => (
                  <tr key={`${r.date}-${r.topic}`}>
                    <td>{r.topic}</td>
                    <td className="text-right">{r.error ? `error: ${r.error}` : r.hidden}</td>
                    <td className="text-right">{r.exists ? r.included : '—'}</td>
                    <td className="text-right">{r.exists ? r.none + r.unknown : '—'}</td>
                    <td>{r.uppercaseUnderTitle === null ? '—' : r.uppercaseUnderTitle ? 'sí' : 'NO'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {revealResults && (
          <div className="mt-2 text-xs">
            <div>Revelados en total: {revealTotal}</div>
            <table className="mt-1 w-full">
              <thead>
                <tr>
                  <th className="text-left">Tema</th>
                  <th className="text-right">Revelados</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {revealResults.map((r) => (
                  <tr key={`${r.date}-${r.topic}`}>
                    <td>{r.topic}</td>
                    <td className="text-right">{r.error ? `error: ${r.error}` : r.revealed}</td>
                    <td className="text-right">{r.exists ? r.total : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-3 text-sm">
        <h2 className="font-bold">Tarjetas por tema (v0.1.4)</h2>
        <button className={btnClass} onClick={() => void runCards()} disabled={busy !== null}>
          {busy === 'cards' ? 'Verificando…' : 'Verificar tarjetas'}
        </button>
        {cardResults && (
          <div className="mt-2 text-xs">
            <div>
              Exactos: {cardResults.exact}/31 · Cortos: {cardResults.short} · De más: {cardResults.extra} ·
              Total real {cardResults.totalActual}/{cardResults.totalExpected} esperadas
            </div>
            <table className="mt-1 w-full">
              <thead>
                <tr>
                  <th className="text-left">Tema</th>
                  <th className="text-right">Esperadas</th>
                  <th className="text-right">Reales</th>
                  <th className="text-left">Estado</th>
                </tr>
              </thead>
              <tbody>
                {cardResults.rows.map((r) => (
                  <tr key={`${r.date}-${r.topic}`}>
                    <td>{r.topic}</td>
                    <td className="text-right">{r.expected}</td>
                    <td className="text-right">{r.error ? `error: ${r.error}` : r.actual}</td>
                    <td>{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="mt-3 text-sm">
        <h2 className="font-bold">Probar mover con setParent (v0.1.5)</h2>
        <div className="text-xs">
          Crea un rem de prueba en COLOPROCTOLOGÍA, lo mueve con setParent a
          CIRUGÍA GENERAL y reporta si mueve limpio o duplica. No toca
          contenido real. Si mueve limpio, el rem ya se borró; si duplica,
          no se borra nada.
        </div>
        <button className={btnClass} onClick={() => void runMove()} disabled={busy !== null}>
          {busy === 'movetest' ? 'Probando…' : 'Probar mover (1 rem)'}
        </button>
        {moveResults.length > 0 && (
          <div className="mt-2 text-xs">
            <table className="mt-1 w-full">
              <thead>
                <tr>
                  <th className="text-left">Cuándo</th>
                  <th className="text-left">Veredicto</th>
                  <th className="text-right">Origen ant./desp.</th>
                  <th className="text-right">Destino ant./desp.</th>
                  <th className="text-left">Borrado</th>
                </tr>
              </thead>
              <tbody>
                {moveResults.map((r) => (
                  <tr key={r.at}>
                    <td>{new Date(r.at).toLocaleString('es-MX')}</td>
                    <td>
                      {r.error
                        ? `error: ${r.error}`
                        : r.verdict === 'mueve-limpio'
                          ? 'MUEVE LIMPIO'
                          : r.verdict === 'duplica'
                            ? 'DUPLICA'
                            : 'INCONCLUSO'}
                    </td>
                    <td className="text-right">
                      {r.beforeSource} → {r.afterSource}
                    </td>
                    <td className="text-right">
                      {r.beforeTarget} → {r.afterTarget}
                    </td>
                    <td>{r.cleanedUp ? 'sí' : 'no'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {moveResults[0]?.notes.map((n) => (
              <div key={n} className="mt-1">
                {n}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

renderWidget(EnarmSyncWidget);
