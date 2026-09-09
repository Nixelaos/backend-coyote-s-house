/**
 * Autenticación con Google OAuth 2.0.
 *
 * No se guardan contraseñas ni se implementa recuperación de cuenta: Google es
 * el único proveedor de identidad. Lo que sí controla este backend es la
 * AUTORIZACIÓN, mediante una allowlist de correos: tener una cuenta de Google
 * no basta para entrar al panel.
 *
 * La sesión es un JWT firmado guardado en una cookie httpOnly. Al ser sin
 * estado, no hace falta un almacén de sesiones y sobrevive a los reinicios.
 */

import fp from 'fastify-plugin';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import oauth2 from '@fastify/oauth2';
import config from '../config.js';

const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const USERINFO_TIMEOUT_MS = 8000;

/** Consulta el perfil del usuario recién autenticado. */
export async function fetchGoogleProfile(accessToken) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), USERINFO_TIMEOUT_MS);

  try {
    const response = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Google userinfo respondió HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function authPlugin(fastify) {
  const { hasGoogleCredentials } = fastify.appConfigStatus;

  await fastify.register(cookie);

  // Sin credenciales de Google no hay panel, pero la API pública sigue viva.
  if (!hasGoogleCredentials) {
    fastify.decorate('authEnabled', false);
    fastify.decorate('requireAdmin', async (request, reply) => {
      return reply.code(503).send({
        error: 'login_deshabilitado',
        message: 'El login de Google no está configurado en este servidor.'
      });
    });
    return;
  }

  fastify.decorate('authEnabled', true);

  await fastify.register(jwt, {
    secret: config.sessionSecret,
    cookie: {
      cookieName: config.sessionCookieName,
      signed: false
    },
    sign: {
      expiresIn: config.sessionMaxAgeSeconds
    }
  });

  await fastify.register(oauth2, {
    name: 'googleOAuth2',
    scope: ['openid', 'email', 'profile'],
    credentials: {
      client: {
        id: config.google.clientId,
        secret: config.google.clientSecret
      },
      auth: oauth2.GOOGLE_CONFIGURATION
    },
    startRedirectPath: '/auth/google',
    callbackUri: config.google.callbackUri,
    // El parámetro state viaja en cookie para impedir CSRF sobre el login.
    cookie: {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProduction
    }
  });

  /** ¿Este correo está autorizado a administrar el sitio? */
  fastify.decorate('isAdminEmail', (email) => {
    if (!email) return false;
    return config.allowedAdminEmails.includes(email.toLowerCase());
  });

  /** Opciones de la cookie de sesión, en un solo lugar para no desincronizarlas. */
  fastify.decorate('sessionCookieOptions', {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    maxAge: config.sessionMaxAgeSeconds
  });

  /**
   * Hook onRequest que protege todo /api/admin/*.
   *
   * Vuelve a comprobar la allowlist en CADA petición, no solo al emitir el
   * token: si se quita un correo de ADMIN_ALLOWED_EMAILS, el acceso se corta
   * de inmediato en vez de seguir vivo hasta que expire la sesión.
   */
  fastify.decorate('requireAdmin', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({
        error: 'no_autenticado',
        message: 'Tu sesión expiró. Vuelve a iniciar sesión con Google.'
      });
    }

    if (!fastify.isAdminEmail(request.user?.email)) {
      reply.clearCookie(config.sessionCookieName, { path: '/' });
      return reply.code(403).send({
        error: 'no_autorizado',
        message: 'Esta cuenta ya no tiene acceso al panel.'
      });
    }
  });
}

export default fp(authPlugin, {
  name: 'coyote-auth',
  fastify: '5.x'
});
