/**
 * Adaptador de almacenamiento sobre archivos JSON.
 *
 * Es el único almacenamiento del backend: schedule.json y banner.json en
 * DATA_DIR. El resto del código habla con la interfaz { get, save } y no sabe
 * que detrás hay archivos.
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
 * No siembra valores por defecto: si el archivo no existe, get() lanza el
 * ENOENT tal cual. Crear el archivo con un horario inventado lo publicaría
 * como si alguien lo hubiera guardado; quien llama decide qué hacer con la
 * ausencia (la API pública responde 503, el panel ofrece un punto de partida).
 *
 * @param {object} options
 * @param {string} options.filePath  Ruta absoluta del archivo.
 * @param {(raw: object) => object} [options.normalize] Saneado al leer.
 */
export function createJsonRepository({ filePath, normalize }) {
  const apply = typeof normalize === 'function' ? normalize : (value) => value;

  return {
    async get() {
      const raw = await fs.readFile(filePath, 'utf8');

      try {
        return apply(JSON.parse(raw));
      } catch (error) {
        if (error instanceof SyntaxError) {
          // Un JSON dañado se informa con un código propio y sin sobrescribir
          // el archivo: todavía puede repararse a mano.
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
