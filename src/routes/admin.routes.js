/**
 * API de administración. Todo lo de aquí exige sesión válida y correo
 * autorizado; el preHandler requireAdmin se aplica a todo el ámbito.
 *
 * No se registra CORS en este ámbito: el panel se sirve desde el mismo origen,
 * así que el navegador bloquea por defecto cualquier intento de escritura
 * desde otro sitio.
 */

import { scheduleRepository, normalizeSchedule } from '../repositories/schedule.repo.js';
import { bannerRepository, normalizeBanner } from '../repositories/banner.repo.js';
import { computeStatus } from '../lib/schedule-status.js';
import { DEFAULT_SCHEDULE, DEFAULT_BANNER } from '../lib/defaults.js';
import { scheduleBodySchema, validateScheduleRules } from '../schemas/schedule.schema.js';
import { bannerBodySchema, validateBannerRules } from '../schemas/banner.schema.js';

/** Cupo de escrituras: generoso para una persona, ajustado para un bot. */
const WRITE_RATE_LIMIT = { max: 30, timeWindow: '1 minute' };

/** Respuesta 400 uniforme para los errores de reglas de negocio. */
function sendValidationError(reply, errors) {
  return reply.code(400).send({
    error: 'validacion',
    message: errors[0],
    details: errors
  });
}

/**
 * Lee un recurso para el panel. Si el archivo todavía no existe o está dañado,
 * el panel recibe los valores iniciales en vez de un error: sin eso nadie
 * podría guardar el primer horario ni reemplazar un archivo roto.
 * `published: false` le avisa que el sitio no está mostrando esos datos; no se
 * publican hasta que alguien los guarde.
 */
async function readForPanel(repository, initial, request, resource) {
  try {
    return { data: await repository.get(), published: true };
  } catch (error) {
    if (error.code === 'ENOENT') {
      request.log.info({ resource }, 'Sin datos guardados: el panel parte de los valores iniciales');
    } else {
      request.log.error({ err: error, resource }, 'Datos ilegibles: el panel parte de los valores iniciales');
    }
    return { data: initial, published: false };
  }
}

export default async function adminRoutes(fastify) {
  // Protege absolutamente todas las rutas registradas en este ámbito.
  //
  // Va en onRequest y no en preHandler a propósito: preHandler corre DESPUÉS
  // de validar el body, así que una petición anónima recibiría un 400 con el
  // detalle del esquema en vez de un 401 limpio. Autenticar primero, parsear
  // después.
  fastify.addHook('onRequest', fastify.requireAdmin);

  // Las respuestas del panel jamás deben quedar en una caché intermedia.
  fastify.addHook('onSend', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
  });

  // --- Horario ---------------------------------------------------------

  fastify.get('/api/admin/schedule', async (request) => {
    const { data: schedule, published } = await readForPanel(
      scheduleRepository,
      normalizeSchedule(DEFAULT_SCHEDULE),
      request,
      'horario'
    );
    return { schedule, status: computeStatus(schedule), published };
  });

  fastify.put(
    '/api/admin/schedule',
    {
      config: { rateLimit: WRITE_RATE_LIMIT },
      schema: { body: scheduleBodySchema }
    },
    async (request, reply) => {
      const candidate = normalizeSchedule({
        ...request.body,
        // La zona horaria del taller no se edita desde el panel.
        timezone: 'America/Santiago'
      });

      const errors = validateScheduleRules(candidate);
      if (errors.length > 0) return sendValidationError(reply, errors);

      const saved = await scheduleRepository.save(candidate, request.user);
      request.log.info({ email: request.user.email }, 'Horario actualizado');

      return { schedule: saved, status: computeStatus(saved) };
    }
  );

  // --- Banner ----------------------------------------------------------

  fastify.get('/api/admin/banner', async (request) => {
    const { data: banner, published } = await readForPanel(
      bannerRepository,
      normalizeBanner(DEFAULT_BANNER),
      request,
      'banner'
    );
    return { banner, published };
  });

  fastify.put(
    '/api/admin/banner',
    {
      config: { rateLimit: WRITE_RATE_LIMIT },
      schema: { body: bannerBodySchema }
    },
    async (request, reply) => {
      const candidate = normalizeBanner(request.body);

      const errors = validateBannerRules(candidate);
      if (errors.length > 0) return sendValidationError(reply, errors);

      const saved = await bannerRepository.save(candidate, request.user);
      request.log.info({ email: request.user.email, enabled: saved.enabled }, 'Banner actualizado');

      return { banner: saved };
    }
  );
}
