/**
 * Repositorio del banner de anuncios.
 *
 * Igual que el horario: un archivo JSON (DATA_DIR/banner.json) como única
 * copia, detrás de la misma interfaz:
 *
 *   get()             -> Promise<Banner>   (lanza si falta, está dañado o no es válido)
 *   save(data, user)  -> Promise<Banner>
 */

import path from 'node:path';
import config from '../config.js';
import { DEFAULT_BANNER } from '../lib/defaults.js';
import { validateBannerRules } from '../schemas/banner.schema.js';
import { createJsonRepository } from './json-store.js';

const VALID_SPEEDS = new Set(['slow', 'normal', 'fast']);

function normalizeBanner(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};

  return {
    enabled: Boolean(source.enabled),
    message: typeof source.message === 'string' ? source.message.trim() : '',
    linkUrl: typeof source.linkUrl === 'string' ? source.linkUrl.trim() : '',
    speed: VALID_SPEEDS.has(source.speed) ? source.speed : DEFAULT_BANNER.speed,
    startsAt: source.startsAt || null,
    endsAt: source.endsAt || null,
    updatedAt: source.updatedAt || null,
    updatedBy: source.updatedBy || null
  };
}

/**
 * Lectura del archivo: exige lo mismo que el panel al guardar. Un banner
 * editado a mano con un enlace "javascript:" o fechas imposibles no se
 * publica: se lanza EINVALIDDATA y la API pública sale sin anuncio.
 */
function parseStoredBanner(raw) {
  const banner = normalizeBanner(raw);
  const errors = validateBannerRules(banner);
  if (errors.length > 0) {
    const error = new Error(`El banner guardado no es válido: ${errors.join(' ')}`);
    error.code = 'EINVALIDDATA';
    throw error;
  }
  return banner;
}

/**
 * Decide si el banner debe mostrarse AHORA.
 *
 * La decisión la toma el navegador: la API entrega el banner con
 * startsAt/endsAt, y una pestaña abierta tiene que mostrarlo u ocultarlo
 * cuando empieza o termina la vigencia sin volver a pedir datos. Esta función
 * queda como implementación de referencia para portarla a site-config.js y
 * comparar las dos con la prueba de paridad, igual que el cálculo de
 * abierto/cerrado.
 * El mensaje vacío nunca se publica, aunque el interruptor esté activo.
 */
export function resolveBannerVisibility(banner, reference = new Date()) {
  if (!banner.enabled || !banner.message) return false;

  const now = reference.getTime();

  if (banner.startsAt) {
    const starts = Date.parse(banner.startsAt);
    if (Number.isFinite(starts) && now < starts) return false;
  }

  if (banner.endsAt) {
    const ends = Date.parse(banner.endsAt);
    if (Number.isFinite(ends) && now > ends) return false;
  }

  return true;
}

const store = createJsonRepository({
  filePath: path.join(config.paths.data, 'banner.json'),
  normalize: parseStoredBanner
});

export const bannerRepository = {
  get() {
    return store.get();
  },

  save(data, user) {
    return store.save({
      ...data,
      updatedAt: new Date().toISOString(),
      updatedBy: user?.email || 'desconocido'
    });
  }
};

export { normalizeBanner };
