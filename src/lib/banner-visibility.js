/**
 * Decide si el banner debe mostrarse en un instante dado.
 *
 * La decisión la toma el navegador: la API entrega el banner con
 * startsAt/endsAt, y una pestaña abierta tiene que mostrarlo u ocultarlo
 * cuando empieza o termina la vigencia sin volver a pedir datos. Esta es la
 * implementación de referencia; coyote-s-house/js/lib/site-config.js la repite
 * (bannerVisible) y paridad.test.mjs compara las dos.
 *
 * Vive aparte, sin importar config ni repositorios, para que la prueba de
 * paridad la cargue sin efectos secundarios.
 *
 * El mensaje vacío nunca se publica, aunque el interruptor esté activo.
 */
export function resolveBannerVisibility(banner, reference = new Date()) {
  if (!banner.enabled || !banner.message) return false;

  const now = reference.getTime();

  if (banner.startsAt) {
    const starts = Date.parse(banner.startsAt);
    if (Number.isFinite(starts) && now < starts) return false;
  }

  if (banner.endsAt) {
    const ends = Date.parse(banner.endsAt);
    if (Number.isFinite(ends) && now > ends) return false;
  }

  return true;
}
