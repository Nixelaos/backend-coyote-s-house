/**
 * Inventario de lo que el backend sirve del sitio público.
 *
 * La lista de páginas es cerrada a propósito: Fastify solo lee del disco los
 * archivos que están aquí. Aceptar "cualquier ruta que termine en .html"
 * abriría la puerta a leer archivos fuera del sitio (path traversal) y a
 * dejar en Cloudflare respuestas para URLs que no existen.
 *
 * La misma lista sirve para tres cosas, y por eso vive aparte de las rutas:
 *   - site.routes.js registra una ruta por página;
 *   - security.js excluye páginas y estáticos del límite de peticiones;
 *   - la purga de Cloudflare (paso 6 de la fase B) arma las URLs a limpiar.
 */

/** Nombres de archivo, sin extensión, de las 9 páginas de coyote-s-house/. */
export const SITE_PAGES = Object.freeze([
  'index',
  'caso-ajuste-motor',
  'contacto',
  'cotizador',
  'faq',
  'galeria',
  'resenas',
  'servicios',
  'sobre-alberto'
]);

/** Carpetas del sitio con recursos estáticos que Fastify sirve en desarrollo. */
export const SITE_ASSET_DIRS = Object.freeze(['css', 'js', 'assets', 'fonts']);

/**
 * Rutas HTTP de una página: "index" responde en "/" y en "/index.html"; el
 * resto solo en "/<nombre>.html". Son entradas distintas para la caché y
 * para la purga, así que se enumeran las dos.
 */
export function pagePaths(name) {
  const paths = [`/${name}.html`];
  if (name === 'index') paths.unshift('/');
  return paths;
}

/** Todas las rutas de páginas: "/", "/index.html", "/caso-ajuste-motor.html", ... */
export const SITE_PAGE_PATHS = Object.freeze(SITE_PAGES.flatMap(pagePaths));

const PAGE_PATH_SET = new Set(SITE_PAGE_PATHS);
const ASSET_PREFIX = new RegExp(`^/(${SITE_ASSET_DIRS.join('|')})/`);

/** ¿Es un recurso estático del sitio (css, js, imágenes, fuentes)? */
export function isSiteAssetPath(pathname) {
  return ASSET_PREFIX.test(pathname);
}

/** ¿Es una página o un recurso del sitio público? Recibe el pathname sin query string. */
export function isPublicSitePath(pathname) {
  return PAGE_PATH_SET.has(pathname) || isSiteAssetPath(pathname);
}
