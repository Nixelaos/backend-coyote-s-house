/**
 * Render de las páginas del sitio público: toma el HTML tal cual está en el
 * repo del sitio y le mete los datos que administra el taller.
 *
 * No se renderizan componentes en Node (decisión del 11/09): el sitio ya son
 * web components que pintan en el navegador. Lo que evita el parpadeo es que
 * pinten UNA vez con los datos correctos, y para eso basta con que los datos
 * viajen dentro del HTML, antes de que corra ningún script.
 *
 * Dos intervenciones, las dos sobre texto, sin parsear el documento:
 *
 *   1. Antes de </head> se inserta
 *        <script type="application/json" id="coyote-config">{...}</script>
 *      con el resultado de buildPublicConfig(). Es un bloque de datos, no
 *      código: la CSP no lo bloquea y el navegador no lo ejecuta. El
 *      site-config.js del sitio lo lee de forma síncrona (paso 4).
 *
 *   2. Si la página trae datos estructurados de Schema.org
 *      (<script type="application/ld+json">, hoy solo index.html), se
 *      reescribe openingHoursSpecification con el horario real. Si no se
 *      hiciera, Google seguiría mostrando en los resultados el horario que el
 *      taller ya cambió.
 *
 * Este módulo es puro: recibe strings y objetos, devuelve un string. Así se
 * prueba sin Fastify y sin disco.
 */

const HEAD_CLOSE = /<\/head\s*>/i;
const JSON_LD_BLOCK = /<script\s+type=["']application\/ld\+json["']\s*>([\s\S]*?)<\/script>/i;

// U+2028 y U+2029 se construyen por código y no se escriben en el fuente:
// dentro de un literal algunos editores los convierten en un salto de línea
// real y la expresión regular queda rota sin que se vea.
const LINE_SEPARATORS = new RegExp(`[${String.fromCharCode(0x2028, 0x2029)}]`, 'g');

const SCHEMA_DAY = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday'
};

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/**
 * JSON seguro para incrustar dentro de un <script>.
 *
 * JSON.stringify no escapa "<", así que un mensaje de banner que contenga
 * "</script>" cerraría el bloque y lo que siguiera se ejecutaría como código.
 * Como "<" solo puede aparecer dentro de strings JSON, escaparlo en todo el
 * texto es seguro y el resultado sigue siendo JSON válido. U+2028 y U+2029
 * se escapan también: JSON los acepta crudos, JavaScript los trata como
 * saltos de línea.
 */
export function escapeJsonForHtml(value, indent) {
  return JSON.stringify(value, null, indent)
    .replace(/</g, '\\u003c')
    .replace(LINE_SEPARATORS, (char) => `\\u${char.charCodeAt(0).toString(16)}`);
}

/**
 * openingHoursSpecification de Schema.org a partir del horario semanal.
 *
 * Agrupa los días que comparten el mismo tramo aunque no sean consecutivos,
 * exactamente como lo hacía actualizarDatosEstructurados() en el sitio. Las
 * excepciones (feriados) no se incluyen: Schema.org las modela aparte
 * (specialOpeningHoursSpecification) y hoy nadie las consume.
 */
export function buildOpeningHoursSpecification(schedule) {
  const groups = new Map();

  for (const dayIndex of DAY_ORDER) {
    const day = schedule.days?.[dayIndex] || schedule.days?.[String(dayIndex)];
    if (!day || day.closed) continue;

    const key = `${day.open}-${day.close}`;
    if (!groups.has(key)) {
      groups.set(key, {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: [],
        opens: day.open,
        closes: day.close
      });
    }
    groups.get(key).dayOfWeek.push(SCHEMA_DAY[dayIndex]);
  }

  return [...groups.values()];
}

/**
 * Reescribe openingHoursSpecification dentro del primer bloque JSON-LD.
 *
 * Si la página no tiene bloque, si el JSON no se puede leer o si no declara
 * horario, se devuelve el HTML intacto: un JSON-LD raro no debe impedir que
 * el sitio se sirva.
 */
export function updateStructuredData(html, schedule) {
  const match = JSON_LD_BLOCK.exec(html);
  if (!match) return html;

  let data;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return html;
  }
  if (!data || typeof data !== 'object' || !('openingHoursSpecification' in data)) return html;

  data.openingHoursSpecification = buildOpeningHoursSpecification(schedule);

  // Se conserva la sangría de dos espacios de la plantilla para que "ver
  // código fuente" siga siendo legible.
  const body = escapeJsonForHtml(data, 2)
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
  const block = `<script type="application/ld+json">\n${body}\n  </script>`;

  return html.slice(0, match.index) + block + html.slice(match.index + match[0].length);
}

/** Bloque de datos que leerá site-config.js en el navegador. */
export function buildConfigBlock(publicConfig) {
  return `<script type="application/json" id="coyote-config">${escapeJsonForHtml(publicConfig)}</script>`;
}

/**
 * Página lista para servir.
 *
 * @param {string} html          Contenido del archivo .html del sitio.
 * @param {object} publicConfig  Resultado de buildPublicConfig().
 * @returns {string}
 */
export function renderSitePage(html, publicConfig) {
  const withStructuredData = updateStructuredData(html, publicConfig.schedule);

  const headEnd = HEAD_CLOSE.exec(withStructuredData);
  if (!headEnd) {
    // Sin </head> no hay dónde poner el bloque. Es un error de la plantilla,
    // no del dato, y servir la página sin datos sería fallar en silencio:
    // mejor un 500 que se vea en el log.
    throw new Error('La página no tiene </head>; no se puede inyectar la configuración del sitio.');
  }

  const block = buildConfigBlock(publicConfig);
  return `${withStructuredData.slice(0, headEnd.index)}  ${block}\n${withStructuredData.slice(headEnd.index)}`;
}
