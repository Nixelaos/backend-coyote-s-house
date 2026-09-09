/**
 * Repositorio del banner de anuncios.
 *
 * INTERFAZ PÚBLICA — idéntica a la del horario, para que el adaptador de Neon
 * sea un reemplazo directo:
 *
 *   get()             -> Promise<Banner>
 *   save(data, user)  -> Promise<Banner>
 */

import path from 'node:path';
import config from '../config.js';
import { DEFAULT_BANNER } from '../lib/defaults.js';
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
 * Decide si el banner debe mostrarse AHORA.
 *
 * La ventana de vigencia se evalúa en el servidor y no en el navegador: si se
 * dejara al cliente, un reloj mal configurado mostraría una promoción vencida.
 * Además el mensaje vacío nunca se publica, aunque el interruptor esté activo.
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
  defaults: DEFAULT_BANNER,
  normalize: normalizeBanner
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
