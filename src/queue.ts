/**
 * Cola de resúmenes ENARM: el JSON que el plugin descarga (fetch) y
 * convierte en documentos de RemNote. La cola vive en un sitio estático
 * público y la actualiza la extracción diaria de las 6:30 (un tema nuevo
 * por día, más los temas de reposición). El plugin nunca inventa temas:
 * solo importa lo que viene en la cola.
 *
 * Formato:
 * {
 *   "version": 1,
 *   "updated_at": "2026-11-12T03:15:00-06:00",
 *   "topics": [
 *     {
 *       "date": "2026-11-09",
 *       "day": 16,
 *       "topic": "Control prenatal",
 *       "especialidad": "GINECOLOGÍA Y OBSTETRICIA",
 *       "markdown": "# Control prenatal\n\n### ⭐ Detalles.\n ..."
 *     }
 *   ]
 * }
 */

export interface EnarmTopic {
  date: string;
  day: number;
  topic: string;
  especialidad: string;
  markdown: string;
}

export interface EnarmQueue {
  version: number;
  updated_at: string;
  topics: EnarmTopic[];
}

function isEnarmTopic(value: unknown): value is EnarmTopic {
  if (typeof value !== 'object' || value === null) return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.date === 'string' &&
    typeof t.topic === 'string' &&
    t.topic.trim().length > 0 &&
    typeof t.especialidad === 'string' &&
    t.especialidad.trim().length > 0 &&
    typeof t.markdown === 'string' &&
    t.markdown.trim().length > 0
  );
}

export async function fetchQueue(url: string): Promise<EnarmQueue> {
  // La cola se sirve en la raíz (/queue.json) y también hay una copia
  // garantizada en /assets/queue.json. Si la ruta principal falla, se
  // intenta la otra antes de dar el error: así no depende de cuál de las
  // dos publique el host estático.
  const candidates = [url, alternateQueueUrl(url)].filter(
    (u, i, arr) => u !== '' && arr.indexOf(u) === i,
  );
  let lastError: Error | null = null;
  for (const candidate of candidates) {
    try {
      return await fetchQueueOnce(candidate);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastError ?? new Error('No se pudo leer la cola de resúmenes');
}

/**
 * Devuelve la ruta alterna de la cola: /queue.json <-> /assets/queue.json.
 * Si la URL no termina en ninguna de las dos, devuelve '' (sin alterna).
 */
function alternateQueueUrl(url: string): string {
  if (url.endsWith('/assets/queue.json')) {
    return url.slice(0, -'/assets/queue.json'.length) + '/queue.json';
  }
  if (url.endsWith('/queue.json')) {
    return url.slice(0, -'/queue.json'.length) + '/assets/queue.json';
  }
  return '';
}

async function fetchQueueOnce(url: string): Promise<EnarmQueue> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`No se pudo leer la cola de resúmenes (HTTP ${res.status})`);
  }
  const data: unknown = await res.json();
  if (typeof data !== 'object' || data === null || !Array.isArray((data as EnarmQueue).topics)) {
    throw new Error('La cola no tiene el formato esperado (falta el arreglo "topics")');
  }
  const topics = (data as EnarmQueue).topics.filter(isEnarmTopic);
  if (topics.length === 0) {
    throw new Error('La cola no trae ningún tema válido');
  }
  return { ...(data as EnarmQueue), topics };
}
