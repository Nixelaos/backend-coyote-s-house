/**
 * API pública de solo lectura: el horario y el banner que muestra el sitio.
 *
 * El sitio es HTML estático (nginx en la VM, cacheado por Cloudflare) y pide
 * estos datos al cargar cada página. Por eso esta respuesta no se cachea: un
 * cambio guardado desde el panel tiene que verse en la visita siguiente, no
 * cuando venza una caché. En Cloudflare, /api/ va con "Bypass cache".
 *
 * Principio de diseño: nunca datos inventados.
 *   - Sin horario legible (el archivo aún no existe o está dañado) se responde
 *     503 y el sitio no muestra horario ni anuncio.
 *   - Sin banner legible se publica "sin anuncio": no mostrar una franja no
 *     afirma nada falso, y no hay motivo para esconder un horario real.
 */

import cors from '@fastify/cors';
import { scheduleRepository } from '../repositories/schedule.repo.js';
import { bannerRepository, normalizeBanner } from '../repositories/banner.repo.js';
import { computeStatus } from '../lib/schedule-status.js';
import { buildPublicConfig } from '../lib/public-config.js';

export default async function publicRoutes(fastify) {
  // CORS abierto, pero acotado a este ámbito: en desarrollo el sitio se sirve
  // desde otro puerto (por ejemplo localhost:5500) y pide los datos a :3000. En
  // la VM nginx deja sitio y API bajo el mismo origen. Es seguro porque aquí
  // solo se lee información que ya es pública y no se aceptan cookies.
  await fastify.register(cors, {
    origin: '*',
    methods: ['GET', 'HEAD', 'OPTIONS'],
    credentials: false,
    maxAge: 86400
  });

  fastify.get('/api/public/site-config', async (request, reply) => {
    let schedule;

    try {
      schedule = await scheduleRepository.get();
    } catch (error) {
      if (error.code === 'ENOENT') {
        request.log.warn('Todavía no hay horario guardado: el sitio no muestra horario ni anuncio');
      } else {
        request.log.error({ err: error }, 'No se pudo leer el horario: el sitio no muestra horario ni anuncio');
      }

      // no-store: un 503 guardado en alguna caché seguiría tapando el horario
      // cuando vuelva a estar disponible.
      return reply
        .code(503)
        .header('Cache-Control', 'no-store')
        .send({ error: 'sin_horario', message: 'El horario no está disponible en este momento.' });
    }

    let banner;

    try {
      banner = await bannerRepository.get();
    } catch (error) {
      if (error.code !== 'ENOENT') {
        request.log.error({ err: error }, 'No se pudo leer el banner; se publica sin anuncio');
      }
      banner = normalizeBanner({});
    }

    // no-cache: el navegador puede guardar la respuesta pero la revalida cada
    // vez. Evitar peticiones repetidas es trabajo del sitio, no de esta cabecera.
    reply.header('Cache-Control', 'no-cache');

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
