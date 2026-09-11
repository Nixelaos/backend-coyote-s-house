/**
 * API pública de solo lectura.
 *
 * Desde la fase B el sitio ya no la consulta: el horario y el banner viajan
 * dentro del HTML (routes/site.routes.js). Se conserva porque devuelve
 * EXACTAMENTE el mismo JSON que va embebido en las páginas, más el estado
 * resuelto, así que es la forma más rápida de ver qué está publicando el
 * backend sin abrir el código fuente de una página.
 *
 * Principio de diseño: esta ruta NUNCA falla. Si el archivo de datos está
 * corrupto o ilegible, se responde 200 con los valores por defecto y se
 * registra el problema. Aquí eso es aceptable porque Cloudflare no cachea
 * /api (regla 1 de despliegue.md 5.7); en las páginas, con caché delante, la
 * misma falla responde 503 para no envenenarla.
 */

import cors from '@fastify/cors';
import { scheduleRepository, normalizeSchedule } from '../repositories/schedule.repo.js';
import { bannerRepository, normalizeBanner } from '../repositories/banner.repo.js';
import { computeStatus } from '../lib/schedule-status.js';
import { DEFAULT_SCHEDULE, DEFAULT_BANNER } from '../lib/defaults.js';
import { buildPublicConfig } from '../lib/public-config.js';

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
      banner = normalizeBanner(DEFAULT_BANNER);
    }

    reply.header('Cache-Control', CACHE_CONTROL);

    return {
      ...buildPublicConfig(schedule, banner),
      // El estado resuelto es solo para depurar desde el navegador: el sitio
      // lo recalcula con su propio reloj y nunca lo lee de aquí.
      status: computeStatus(schedule)
    };
  });

  fastify.get('/health', async () => ({
    status: 'ok',
    service: "coyotes-house-backend",
    timestamp: new Date().toISOString()
  }));
}
