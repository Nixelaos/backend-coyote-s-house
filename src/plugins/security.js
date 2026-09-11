/**
 * Cabeceras de seguridad y límite de peticiones.
 *
 * CORS NO se registra aquí a propósito: el panel se sirve desde este mismo
 * origen y por lo tanto no lo necesita. Solo el endpoint público lo activa,
 * dentro de su propio ámbito (ver routes/public.routes.js), de modo que las
 * rutas de administración quedan cerradas a peticiones de otros orígenes.
 */

import fp from 'fastify-plugin';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import config from '../config.js';
import { isPublicSitePath } from '../lib/site-pages.js';

async function securityPlugin(fastify) {
  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // El panel usa archivos .js externos, nunca scripts en línea.
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        // Las fotos de perfil de Google se sirven desde googleusercontent.
        imgSrc: ["'self'", 'data:', 'https://lh3.googleusercontent.com', 'https://*.googleusercontent.com'],
        connectSrc: ["'self'"],
        // El login redirige a accounts.google.com.
        formAction: ["'self'", 'https://accounts.google.com'],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        upgradeInsecureRequests: config.isProduction ? [] : null
      }
    },
    // Las imágenes de Google no envían CORP, así que COEP las bloquearía.
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: config.isProduction ? { maxAge: 15552000, includeSubDomains: true } : false
  });

  await fastify.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    // El endpoint público y las páginas del sitio son cacheables y los pide
    // cualquier visitante: no tiene sentido castigarlos con el mismo cupo que
    // un intento de login. Además, una purga de Cloudflare provoca una ráfaga
    // de todas las páginas a la vez. Los estáticos entran por lo mismo: en
    // desarrollo un solo refresco carga unos 25 recursos.
    allowList: (request) => {
      const pathname = request.url.split('?', 1)[0];
      return pathname.startsWith('/api/public/') || isPublicSitePath(pathname);
    },
    errorResponseBuilder: () => ({
      error: 'demasiadas_peticiones',
      message: 'Demasiadas peticiones seguidas. Espera un momento e inténtalo de nuevo.'
    })
  });
}

export default fp(securityPlugin, {
  name: 'coyote-security',
  fastify: '5.x'
});
