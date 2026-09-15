/**
 * Arma el JSON público con el horario y el banner que devuelve
 * /api/public/site-config y que el sitio lee al cargar cada página.
 *
 * Qué se publica y qué no:
 *
 *   - El horario completo (días y excepciones), no el estado abierto/cerrado.
 *     El estado es función de la hora actual: lo calcula el navegador con su
 *     reloj, cada minuto, sin volver a pedir datos.
 *
 *   - El banner tal cual está guardado, con su ventana de vigencia
 *     (startsAt/endsAt). Por el mismo motivo la ventana NO se evalúa aquí: la
 *     decide el navegador en el momento de mostrarlo (ver
 *     lib/banner-visibility.js).
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
