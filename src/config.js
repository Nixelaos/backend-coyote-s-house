/**
 * Configuración central del backend.
 * Lee las variables de entorno una sola vez, las valida y falla temprano
 * con un mensaje entendible en lugar de reventar a mitad de una petición.
 */

import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

loadDotenv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

/** Convierte "a@x.com, b@y.com" en ['a@x.com', 'b@y.com'] sin vacíos ni espacios. */
function parseList(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

const publicBaseUrl = (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

const config = {
  nodeEnv: NODE_ENV,
  isProduction,

  port: Number.parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  publicBaseUrl,

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    callbackUri: `${publicBaseUrl}/auth/google/callback`
  },

  sessionSecret: process.env.SESSION_SECRET || '',
  sessionCookieName: 'coyote_admin',
  sessionMaxAgeSeconds: 60 * 60 * 12, // 12 horas

  // Correos de Google autorizados, normalizados a minúsculas para comparar sin sorpresas.
  allowedAdminEmails: parseList(process.env.ADMIN_ALLOWED_EMAILS).map((email) => email.toLowerCase()),

  allowedOrigins: parseList(process.env.ALLOWED_ORIGINS),

  paths: {
    root: ROOT_DIR,
    // schedule.json y banner.json: el único almacenamiento, no hay base de
    // datos. En la VM va fuera del repo (DATA_DIR=/var/lib/coyote) para que ni
    // un despliegue ni un `git clean` se lleven los datos.
    data: process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT_DIR, 'data'),
    adminPublic: path.join(ROOT_DIR, 'public', 'admin')
  },

  timezone: 'America/Santiago'
};

/**
 * Verifica la configuración. Los errores impiden arrancar; los avisos solo se
 * registran, para poder levantar el servidor y probar la API pública antes de
 * tener las credenciales de Google listas.
 */
export function validateConfig() {
  const errors = [];
  const warnings = [];

  if (!Number.isInteger(config.port) || config.port <= 0) {
    errors.push('PORT debe ser un número de puerto válido.');
  }

  const hasGoogleCredentials = Boolean(config.google.clientId && config.google.clientSecret);

  if (!hasGoogleCredentials) {
    const message =
      'Faltan GOOGLE_CLIENT_ID y/o GOOGLE_CLIENT_SECRET: el panel de administración quedará deshabilitado.';
    if (isProduction) errors.push(message);
    else warnings.push(`${message} La API pública sí funciona.`);
  }

  if (!config.sessionSecret || config.sessionSecret.length < 32) {
    const message = 'SESSION_SECRET debe existir y tener al menos 32 caracteres.';
    if (isProduction || hasGoogleCredentials) errors.push(message);
    else warnings.push(`${message} Se omite porque el login está deshabilitado.`);
  }

  if (config.allowedAdminEmails.length === 0 && hasGoogleCredentials) {
    // Sin allowlist cualquier persona con cuenta de Google entraría al panel.
    errors.push('ADMIN_ALLOWED_EMAILS no puede estar vacío cuando el login de Google está activo.');
  }

  if (isProduction && !config.publicBaseUrl.startsWith('https://')) {
    errors.push('PUBLIC_BASE_URL debe usar https en producción (la cookie de sesión es Secure).');
  }

  return { errors, warnings, hasGoogleCredentials };
}

export default config;
