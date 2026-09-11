/**
 * Arma el JSON público con el horario y el banner: es lo que va embebido en
 * el HTML de cada página (site-render.js) y lo que devuelve
 * /api/public/site-config. Una sola función para que nunca diverjan.
 *
 * Qué se publica y qué no:
 *
 *   - El horario completo (días y excepciones), no el estado abierto/cerrado.
 *     El estado es función de la hora actual y el HTML puede llevar una hora
 *     en caché: lo calcula el navegador con su reloj, cada minuto.
 *
 *   - El banner tal cual está guardado, con su ventana de vigencia
 *     (startsAt/endsAt). Por el mismo motivo, la ventana NO se evalúa aquí:
 *     la misma copia cacheada tiene que ser correcta antes, durante y después
 *     de la vigencia, y eso solo se logra si quien decide es el navegador en
 *     el momento de mostrarla. Es la decisión del 11/09 (fase B, paso 2); la
 *     evaluación en el cliente llega con el paso 4 y se cubre con la prueba
 *     de paridad, igual que el cálculo del estado.
 *
 *   - updatedBy queda fuera: es un correo y esto es público.
 */

/**
 * @param {object} schedule  Horario normalizado (schedule.repo.js).
 * @param {object} banner    Banner normalizado (banner.repo.js).
 */
export function buildPublicConfig(schedule, banner) {
  // El interruptor solo cuenta si hay mensaje. El panel ya impide guardar la
  // combinación; se repite aquí por si el dato viene de un archivo editado a
  // mano, para no publicar una franja vacía.
  const enabled = Boolean(banner.enabled && banner.message);

  return {
    schedule: {
      timezone: schedule.timezone,
      days: schedule.days,
      exceptions: schedule.exceptions
    },
    banner: enabled
      ? {
          enabled: true,
          message: banner.message,
          linkUrl: banner.linkUrl,
          speed: banner.speed,
          startsAt: banner.startsAt,
          endsAt: banner.endsAt
        }
      : {
          enabled: false,
          message: '',
          linkUrl: '',
          speed: banner.speed,
          startsAt: null,
          endsAt: null
        },
    updatedAt: schedule.updatedAt
  };
}
