/**
 * Adaptador de almacenamiento sobre archivos JSON.
 *
 * Cumple dos papeles según STORAGE_DRIVER:
 *   json -> es EL almacenamiento (desarrollo local, sin Neon).
 *   neon -> es el ESPEJO en disco de Neon, lo único que lee el sitio público
 *           (ver mirror-store.js).
 *
 * Todo el resto del backend habla con la interfaz { get, save } y no sabe que
 * detrás hay archivos, así que ninguno de los dos papeles obliga a tocar rutas
 * ni UI.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Escrituras en cola por archivo.
 * Dos peticiones simultáneas al mismo recurso se aplican una después de otra
 * en vez de pisarse a mitad de camino.
 */
const writeQueues = new Map();

function enqueueWrite(filePath, task) {
  const previous = writeQueues.get(filePath) || Promise.resolve();
  // Se encadena incluso si la anterior falló, para no bloquear la cola para siempre.
  const next = previous.then(task, task);
  writeQueues.set(
    filePath,
    next.catch(() => {})
  );
  return next;
}

/**
 * Escritura atómica: se escribe en un archivo temporal y recién ahí se mueve
 * sobre el definitivo. Si el proceso muere a mitad de la escritura, el JSON
 * original queda intacto en vez de quedar truncado.
 */
async function writeAtomic(filePath, data) {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  const contents = `${JSON.stringify(data, null, 2)}\n`;

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(tmpPath, contents, 'utf8');

  try {
    await fs.rename(tmpPath, filePath);
  } catch (error) {
    await fs.rm(tmpPath, { force: true });
    throw error;
  }
}

/**
 * Crea un repositorio respaldado por un archivo JSON.
 *
 * @param {object} options
 * @param {string} options.filePath  Ruta absoluta del archivo.
 * @param {object} options.defaults  Contenido inicial si el archivo no existe.
 * @param {(raw: object) => object} [options.normalize] Saneado al leer.
 * @param {boolean} [options.seedOnMissing=true]
 *   Con `true` (el comportamiento de siempre) un archivo ausente se crea con
 *   `defaults`. Con `false` la ausencia se propaga como error ENOENT: es lo
 *   que necesita mirror-store.js, donde el archivo es una COPIA de otro
 *   almacén y sembrarlo con valores por defecto ocultaría que la copia falta.
 */
export function createJsonRepository({ filePath, defaults, normalize, seedOnMissing = true }) {
  const apply = typeof normalize === 'function' ? normalize : (value) => value;

  return {
    async get() {
      try {
        const raw = await fs.readFile(filePath, 'utf8');
        return apply(JSON.parse(raw));
      } catch (error) {
        if (error.code === 'ENOENT' && seedOnMissing) {
          // Primer arranque: se siembra el archivo con los valores por defecto.
          const seeded = apply(structuredClone(defaults));
          await enqueueWrite(filePath, () => writeAtomic(filePath, seeded));
          return seeded;
        }
        if (error instanceof SyntaxError) {
          // Un JSON corrupto no debe tumbar el sitio público: se avisa y se sigue
          // con los valores por defecto, sin sobrescribir el archivo dañado.
          const wrapped = new Error(`El archivo ${path.basename(filePath)} tiene JSON inválido.`);
          wrapped.code = 'ECORRUPTJSON';
          wrapped.cause = error;
          throw wrapped;
        }
        throw error;
      }
    },

    async save(data) {
      const normalized = apply(data);
      await enqueueWrite(filePath, () => writeAtomic(filePath, normalized));
      return normalized;
    }
  };
}
