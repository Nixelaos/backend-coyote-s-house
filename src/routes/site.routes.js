/**
 * Páginas del sitio público, servidas por Fastify con el horario y el banner
 * ya dentro del HTML.
 *
 * Por qué Fastify y no nginx a secas: nginx solo puede entregar el archivo
 * tal cual, y entonces el navegador tendría que pedir el horario aparte
 * (fetch, parpadeo, un respaldo escrito a mano que envejece). Aquí el HTML
 * sale con los datos del espejo (data/*.json) puestos antes de </head>, y
 * nginx y Cloudflare cachean el resultado (fase B de despliegue.md).
 *
 * Reglas:
 *
 *   - Lista cerrada de páginas (lib/site-pages.js). Lo que no está ahí no se
 *     lee del disco: cae al 404 general.
 *
 *   - Cache-Control: public, max-age=0, s-maxage=3600. El navegador revalida
 *     siempre; Cloudflare guarda una hora (y el panel purga al guardar, paso
 *     6); nginx ignora esta cabecera y usa sus propios 30 s (5.5).
 *
 *   - Si el espejo no se puede leer, 503 con no-store. Servir el horario por
 *     defecto sería mentir, y con una caché delante la mentira quedaría
 *     guardada una hora. Un 503 hace que nginx (proxy_cache_use_stale) siga
 *     entregando la última página buena. Es la inversa deliberada del
 *     "nunca falles" de public.routes.js, que no tiene caché delante.
 *
 *   - helmet desactivado en estas rutas: la CSP del panel prohíbe estilos en
 *     línea y el sitio los usa (index.html, workshop-topbar.js). La CSP
 *     propia del sitio es el paso 3 y reemplaza este `false`.
 *
 * Los repositorios y la carpeta del sitio se pueden inyectar por opciones,
 * para probar el 503 sin corromper archivos reales.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import config from '../config.js';
import { scheduleRepository as defaultScheduleRepository } from '../repositories/schedule.repo.js';
import { bannerRepository as defaultBannerRepository } from '../repositories/banner.repo.js';
import { buildPublicConfig } from '../lib/public-config.js';
import { renderSitePage } from '../lib/site-render.js';
import { SITE_PAGES, pagePaths } from '../lib/site-pages.js';

export const SITE_CACHE_CONTROL = 'public, max-age=0, s-maxage=3600';

/** Segundos que se sugiere esperar antes de reintentar tras un 503. */
const RETRY_AFTER_SECONDS = 30;

/**
 * Lo único que ve un visitante si no hay copia buena en ninguna caché. Sin
 * recursos externos: si llegamos aquí, no conviene depender de nada más.
 */
const UNAVAILABLE_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Coyote's House</title>
</head>
<body style="font-family: sans-serif; text-align: center; padding: 3rem 1rem;">
  <h1>Estamos con un problema técnico</h1>
  <p>El sitio no está disponible en este momento. Vuelve a intentarlo en unos minutos.</p>
  <p>WhatsApp del taller: <a href="https://wa.me/56954750993">+56 9 5475 0993</a></p>
</body>
</html>
`;

export default async function siteRoutes(fastify, options = {}) {
  const scheduleRepository = options.scheduleRepository || defaultScheduleRepository;
  const bannerRepository = options.bannerRepository || defaultBannerRepository;
  const siteRoot = options.siteRoot || config.paths.site;

  async function servePage(name, request, reply) {
    let html;
    try {
      html = await fs.readFile(path.join(siteRoot, `${name}.html`), 'utf8');
    } catch (error) {
      // Está en la lista pero no en el disco: alguien borró la página del
      // sitio. Es un 404 honesto, no un error del servidor.
      if (error.code === 'ENOENT') return reply.callNotFound();
      throw error;
    }

    let schedule;
    let banner;
    try {
      [schedule, banner] = await Promise.all([scheduleRepository.get(), bannerRepository.get()]);
    } catch (error) {
      request.log.error({ err: error, page: name }, 'No se pudo leer el espejo; la página responde 503');
      return reply
        .code(503)
        .header('Cache-Control', 'no-store')
        .header('Retry-After', String(RETRY_AFTER_SECONDS))
        .type('text/html; charset=utf-8')
        .send(UNAVAILABLE_HTML);
    }

    const page = renderSitePage(html, buildPublicConfig(schedule, banner));

    return reply.header('Cache-Control', SITE_CACHE_CONTROL).type('text/html; charset=utf-8').send(page);
  }

  for (const name of SITE_PAGES) {
    for (const url of pagePaths(name)) {
      fastify.get(url, { helmet: false }, (request, reply) => servePage(name, request, reply));
    }
  }
}
