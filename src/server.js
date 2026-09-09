/**
 * COYOTE'S HOUSE - BACKEND
 * Punto de entrada: valida la configuración, arma el servidor y lo levanta.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import config, { validateConfig } from './config.js';
import securityPlugin from './plugins/security.js';
import authPlugin from './plugins/auth.js';
import publicRoutes from './routes/public.routes.js';
import authRoutes from './routes/auth.routes.js';
import adminRoutes from './routes/admin.routes.js';

/**
 * Traduce un error de JSON Schema a algo que una persona pueda entender.
 * "body/days/1/open debe coincidir con el patrón..." no le sirve a nadie.
 */
function describeValidationError(validation) {
  const first = validation?.[0];
  if (!first) return 'Los datos enviados no son válidos.';

  const field = (first.instancePath || '').replace(/^\//, '').replace(/\//g, ' → ');

  if (first.keyword === 'pattern' && field.includes('open')) {
    return `El campo "${field}" debe tener formato de hora HH:MM (por ejemplo 09:00).`;
  }
  if (first.keyword === 'pattern' && field.includes('close')) {
    return `El campo "${field}" debe tener formato de hora HH:MM (por ejemplo 17:00).`;
  }
  if (first.keyword === 'maxLength') {
    return `El campo "${field}" supera el largo máximo permitido.`;
  }
  if (first.keyword === 'required') {
    return `Falta el campo obligatorio "${first.params?.missingProperty}".`;
  }
  if (first.keyword === 'additionalProperties') {
    return `El campo "${first.params?.additionalProperty}" no está permitido.`;
  }

  return field ? `El campo "${field}" ${first.message}.` : 'Los datos enviados no son válidos.';
}

export async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: config.isProduction ? 'info' : 'debug',
      // El nivel de detalle por defecto imprime cabeceras completas, incluida
      // la cookie de sesión. Se recorta a lo justo para no filtrar el token.
      serializers: {
        req(request) {
          return { method: request.method, url: request.url };
        }
      }
    },
    trustProxy: config.isProduction, // Render/Railway/Fly ponen un proxy delante.
    bodyLimit: 64 * 1024
  });

  const status = validateConfig();
  fastify.decorate('appConfigStatus', status);

  for (const warning of status.warnings) {
    fastify.log.warn(warning);
  }

  await fastify.register(securityPlugin);
  await fastify.register(authPlugin);

  await fastify.register(publicRoutes);
  await fastify.register(authRoutes);
  await fastify.register(adminRoutes);

  // Panel de administración (archivos estáticos).
  await fastify.register(fastifyStatic, {
    root: config.paths.adminPublic,
    prefix: '/admin/',
    index: ['index.html'],
    cacheControl: false
  });

  // El panel cambia con cada despliegue: el navegador debe revalidar siempre
  // en vez de quedarse con un admin.js viejo en caché.
  fastify.addHook('onSend', async (request, reply) => {
    if (request.url.startsWith('/admin')) {
      reply.header('Cache-Control', 'no-cache');
    }
  });

  fastify.get('/admin', async (request, reply) => reply.redirect('/admin/'));
  fastify.get('/', async (request, reply) => reply.redirect('/admin/'));

  fastify.setNotFoundHandler(async (request, reply) => {
    return reply.code(404).send({
      error: 'no_encontrado',
      message: `No existe la ruta ${request.method} ${request.url}.`
    });
  });

  fastify.setErrorHandler(async (error, request, reply) => {
    if (error.validation) {
      return reply.code(400).send({
        error: 'validacion',
        message: describeValidationError(error.validation)
      });
    }

    const statusCode = error.statusCode || 500;

    if (statusCode >= 500) {
      request.log.error({ err: error }, 'Error no controlado');
      return reply.code(statusCode).send({
        error: 'error_interno',
        message: 'Ocurrió un error en el servidor. Inténtalo nuevamente.'
      });
    }

    return reply.code(statusCode).send({
      error: error.code || 'error',
      message: error.message
    });
  });

  return fastify;
}

async function start() {
  const status = validateConfig();

  if (status.errors.length > 0) {
    console.error('\n No se puede iniciar el backend de Coyote\'s House:\n');
    for (const error of status.errors) console.error(`   - ${error}`);
    console.error('\n   Revisa tu archivo .env (puedes partir copiando .env.example).\n');
    process.exit(1);
  }

  const fastify = await buildServer();

  try {
    await fastify.listen({ port: config.port, host: config.host });

    fastify.log.info(`Panel de administración: ${config.publicBaseUrl}/admin/`);
    fastify.log.info(`API pública: ${config.publicBaseUrl}/api/public/site-config`);

    if (!status.hasGoogleCredentials) {
      fastify.log.warn('El panel está deshabilitado hasta configurar las credenciales de Google.');
    }
  } catch (error) {
    fastify.log.error(error);
    process.exit(1);
  }

  // Cierre ordenado: termina las peticiones en curso antes de morir.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => {
      fastify.log.info(`Recibido ${signal}, cerrando el servidor...`);
      await fastify.close();
      process.exit(0);
    });
  }
}

// Solo arranca si se ejecuta directamente, para poder importar buildServer en pruebas.
const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  start();
}
