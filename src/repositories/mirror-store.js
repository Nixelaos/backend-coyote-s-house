/**
 * Almacén en dos capas: una fuente de verdad remota (Neon) y un espejo local
 * en disco (JSON) que es lo único que lee el sitio público.
 *
 * Cumple el mismo contrato { get, save } de json-store.js y neon-store.js, más
 * hydrate() para preparar el espejo al arrancar:
 *
 *   save(data) -> escribe en el primario y DESPUÉS en el espejo. Si el
 *                 primario falla, el espejo no se toca. Si el espejo falla
 *                 después de que el primario ya aceptó, se lanza igual: un
 *                 guardado que no llegó a lo que el sitio lee no es un
 *                 guardado, y reintentar es inofensivo porque el primario es
 *                 idempotente.
 *   get()      -> lee el espejo. Solo si falta o está corrupto consulta el
 *                 primario y lo reconstruye. En operación normal ninguna
 *                 lectura toca el primario.
 *   hydrate()  -> una lectura cuyo único resultado es de dónde salió el dato
 *                 ('espejo' o 'primario'); existe para que server.js pueda
 *                 calentar el espejo antes de aceptar tráfico y registrarlo.
 *
 * Por qué así y no al revés: la lectura pública tiene que sobrevivir a que
 * Neon esté suspendida, lenta, caída o en otro país. Con el espejo, la única
 * dependencia del camino de lectura es el disco de la propia máquina.
 */

/** Fallos del espejo que justifican reconstruirlo desde el primario. */
const CODIGOS_RECONSTRUIBLES = new Set(['ENOENT', 'ECORRUPTJSON']);

/**
 * @param {object} options
 * @param {{get: Function, save: Function}} options.primary  Fuente de verdad (neon-store.js).
 * @param {{get: Function, save: Function}} options.mirror   Copia en disco (json-store.js con seedOnMissing: false).
 * @param {string} [options.name='recurso']  Cómo llamar al dato en los mensajes de error.
 */
export function createMirroredStore({ primary, mirror, name = 'recurso' }) {
  if (!primary || !mirror) {
    throw new Error('createMirroredStore necesita un primary y un mirror.');
  }

  async function reconstruir() {
    const fresco = await primary.get();
    await mirror.save(fresco);
    return fresco;
  }

  /** Devuelve el dato y su procedencia; get() y hydrate() se reparten las dos mitades. */
  async function leer() {
    try {
      return { valor: await mirror.get(), origen: 'espejo' };
    } catch (error) {
      if (!CODIGOS_RECONSTRUIBLES.has(error.code)) throw error;
      return { valor: await reconstruir(), origen: 'primario' };
    }
  }

  return {
    async get() {
      return (await leer()).valor;
    },

    async save(data) {
      const guardado = await primary.save(data);

      try {
        await mirror.save(guardado);
      } catch (error) {
        const envuelto = new Error(
          `El ${name} quedó guardado en la base pero no se pudo escribir la copia local ` +
            `que lee el sitio (${error.message}). Reintenta el guardado.`
        );
        envuelto.code = 'EMIRROR';
        envuelto.cause = error;
        throw envuelto;
      }

      return guardado;
    },

    async hydrate() {
      return (await leer()).origen;
    }
  };
}
