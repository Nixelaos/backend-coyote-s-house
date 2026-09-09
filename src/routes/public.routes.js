/**
 * API pública de solo lectura que consume el sitio de Coyote's House.
 *
 * Principio de diseño: esta ruta NUNCA debe fallar de forma que rompa el sitio.
 * Si el archivo de datos está corrupto o ilegible, se responde 200 con los
 * valores por defecto y se registra el problema, en lugar de devolver un 500
 * que dejaría la barra de horario en blanco frente a los clientes.
 */

import cors from '@fastify/cors';
import { scheduleRepository } from '../repositories/schedule.repo.js';
import { bannerRepository, resolveBannerVisibility } from '../repositories/banner.repo.js';
import { computeStatus } from '../lib/schedule-status.js';
import { DEFAULT_SCHEDULE, DEFAULT_BANNER } from '../lib/defaults.js';
import { normalizeSchedule } from '../repositories/schedule.repo.js';

const CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=600';

export default async function publicRoutes(fastify) {
  // CORS abierto, pero acotado a este ámbito: el sitio vive en Netlify y este
  // backend en otro dominio. Es seguro porque aquí solo se lee información que
  // ya es pública y no se aceptan cookies.
  await fastify.register(cors, {
    origin: '*',
    methods: ['GET', 'HEAD', 'OPTIONS'],
    credentials: false,
    maxAge: 86400
  });

  fastify.get('/api/public/site-config', async (request, reply) => {
    let schedule;
    let banner;

    try {
      schedule = await scheduleRepository.get();
    } catch (error) {
      request.log.error({ err: error }, 'No se pudo leer el horario; se usan los valores por defecto');
      schedule = normalizeSchedule(DEFAULT_SCHEDULE);
    }

    try {
      banner = await bannerRepository.get();
    } catch (error) {
      request.log.error({ err: error }, 'No se pudo leer el banner; se omite');
      banner = { ...DEFAULT_BANNER };
    }

    const status = computeStatus(schedule);
    const isBannerVisible = resolveBannerVisibility(banner);

    reply.header('Cache-Control', CACHE_CONTROL);

    return {
      // Se entrega el horario completo para que el navegador recalcule el
      // estado cada minuto sin volver a pedir nada, y además el estado ya
      // resuelto para pintar la primera vez sin parpadeo.
      schedule: {
        timezone: schedule.timezone,
        days: schedule.days,
        exceptions: schedule.exceptions
      },
      banner: isBannerVisible
        ? {
            enabled: true,
            message: banner.message,
            linkUrl: banner.linkUrl,
            speed: banner.speed
          }
        : { enabled: false, message: '', linkUrl: '', speed: banner.speed },
      status,
      // updatedBy queda fuera a propósito: es un correo y esto es público.
      updatedAt: schedule.updatedAt
    };
  });

  fastify.get('/health', async () => ({
    status: 'ok',
    service: "coyotes-house-backend",
    timestamp: new Date().toISOString()
  }));
}
