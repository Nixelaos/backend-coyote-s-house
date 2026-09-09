/**
 * Esquemas de validación del banner de anuncios.
 */

const ISO_DATETIME_PATTERN = '^\\d{4}-\\d{2}-\\d{2}([T ].*)?$';

export const MAX_MESSAGE_LENGTH = 200;

export const bannerBodySchema = {
  type: 'object',
  required: ['enabled'],
  additionalProperties: false,
  properties: {
    enabled: { type: 'boolean' },
    message: { type: 'string', maxLength: MAX_MESSAGE_LENGTH },
    linkUrl: { type: 'string', maxLength: 300 },
    speed: { type: 'string', enum: ['slow', 'normal', 'fast'] },
    startsAt: { type: ['string', 'null'], pattern: ISO_DATETIME_PATTERN },
    endsAt: { type: ['string', 'null'], pattern: ISO_DATETIME_PATTERN }
  }
};

/**
 * Detecta espacios y caracteres de control (código <= 32, o DEL).
 * Se comprueba por code point en vez de con una expresión regular para no
 * dejar bytes de control literales dentro del código fuente.
 */
function hasControlOrSpace(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 32 || code === 127) return true;
  }
  return false;
}

/**
 * Acepta solo enlaces seguros.
 *
 * El mensaje del banner se renderiza como <a href="..."> en el sitio público,
 * así que un "javascript:" guardado aquí se convertiría en XSS para cada
 * visitante. Se permiten rutas relativas del propio sitio, anclas y http(s).
 */
export function isSafeLinkUrl(url) {
  if (!url) return true;

  const value = url.trim();
  if (!value) return true;

  // Un salto de línea dentro de "java\nscript:" burla un filtro que solo
  // mire el prefijo, así que primero se descartan los caracteres invisibles.
  if (hasControlOrSpace(value)) return false;

  // Cualquier cosa con esquema explícito debe ser http o https.
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(value);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') return false;
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }

  // Sin esquema queda una ruta relativa, absoluta o un ancla: todas seguras.
  return true;
}

/**
 * Reglas de negocio del banner.
 * @returns {string[]} lista de errores legibles; vacía si todo está bien.
 */
export function validateBannerRules(banner) {
  const errors = [];
  const message = (banner.message || '').trim();

  // Activarlo sin texto dejaría una franja naranja vacía en todo el sitio.
  if (banner.enabled && !message) {
    errors.push('Para activar el banner debes escribir un mensaje.');
  }

  if (!isSafeLinkUrl(banner.linkUrl)) {
    errors.push(
      'El enlace no es válido. Usa una página del sitio (ej: cotizador.html) o una URL que empiece con https://'
    );
  }

  const starts = banner.startsAt ? Date.parse(banner.startsAt) : null;
  const ends = banner.endsAt ? Date.parse(banner.endsAt) : null;

  if (banner.startsAt && !Number.isFinite(starts)) {
    errors.push('La fecha de inicio de vigencia no es válida.');
  }
  if (banner.endsAt && !Number.isFinite(ends)) {
    errors.push('La fecha de término de vigencia no es válida.');
  }
  if (Number.isFinite(starts) && Number.isFinite(ends) && ends <= starts) {
    errors.push('La fecha de término debe ser posterior a la de inicio.');
  }

  return errors;
}
