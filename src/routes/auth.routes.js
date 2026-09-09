/**
 * Rutas del ciclo de vida de la sesión.
 *
 * GET  /auth/google           -> lo publica @fastify/oauth2 (startRedirectPath)
 * GET  /auth/google/callback  -> vuelta desde Google, aquí se decide y se sella la sesión
 * GET  /auth/me               -> quién está conectado
 * POST /auth/logout           -> cierra la sesión
 */

import config from '../config.js';
import { fetchGoogleProfile } from '../plugins/auth.js';

const LOGIN_PAGE = '/admin/login.html';
const DASHBOARD = '/admin/';

export default async function authRoutes(fastify) {
  if (!fastify.authEnabled) {
    // Sin credenciales de Google se responde con una explicación clara en vez
    // de un 404 desconcertante.
    fastify.get('/auth/google', async (request, reply) =>
      reply.code(503).send({
        error: 'login_deshabilitado',
        message: 'Falta configurar GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en el servidor.'
      })
    );
    return;
  }

  fastify.get(
    '/auth/google/callback',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      let profile;

      try {
        const { token } = await fastify.googleOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);
        profile = await fetchGoogleProfile(token.access_token);
      } catch (error) {
        request.log.error({ err: error }, 'Falló el intercambio de código con Google');
        return reply.redirect(`${LOGIN_PAGE}?error=fallo_google`);
      }

      // Un correo no verificado puede pertenecer a otra persona.
      if (profile.email_verified === false) {
        return reply.redirect(`${LOGIN_PAGE}?error=email_no_verificado`);
      }

      if (!fastify.isAdminEmail(profile.email)) {
        request.log.warn({ email: profile.email }, 'Acceso al panel rechazado: correo fuera de la allowlist');
        return reply.redirect(`${LOGIN_PAGE}?error=no_autorizado`);
      }

      const sessionToken = await reply.jwtSign({
        email: profile.email.toLowerCase(),
        name: profile.name || profile.email,
        picture: profile.picture || ''
      });

      reply.setCookie(config.sessionCookieName, sessionToken, fastify.sessionCookieOptions);
      request.log.info({ email: profile.email }, 'Sesión de administración iniciada');

      return reply.redirect(DASHBOARD);
    }
  );

  fastify.get('/auth/me', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'no_autenticado' });
    }

    if (!fastify.isAdminEmail(request.user?.email)) {
      reply.clearCookie(config.sessionCookieName, { path: '/' });
      return reply.code(403).send({ error: 'no_autorizado' });
    }

    return {
      email: request.user.email,
      name: request.user.name,
      picture: request.user.picture
    };
  });

  fastify.post('/auth/logout', async (request, reply) => {
    reply.clearCookie(config.sessionCookieName, { path: '/' });
    return { ok: true };
  });
}
