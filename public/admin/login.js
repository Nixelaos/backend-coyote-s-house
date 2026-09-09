/**
 * Pantalla de acceso.
 *
 * Traduce el código de error que devuelve el callback de Google a un mensaje
 * que explique qué pasó y qué hacer. "Error 403" no le sirve a nadie.
 */

(function () {
  'use strict';

  var MENSAJES = {
    no_autorizado:
      'Esa cuenta de Google no tiene acceso al panel. Verifica que estés usando el correo autorizado por el taller.',
    email_no_verificado:
      'Tu cuenta de Google no tiene el correo verificado. Verifícalo en tu cuenta de Google y vuelve a intentarlo.',
    fallo_google:
      'No pudimos completar el inicio de sesión con Google. Inténtalo de nuevo en unos segundos.',
    sesion_expirada: 'Tu sesión expiró por seguridad. Vuelve a iniciar sesión para continuar.'
  };

  function mostrarError() {
    var params = new URLSearchParams(window.location.search);
    var codigo = params.get('error');
    if (!codigo) return;

    var alerta = document.getElementById('login-alert');
    var texto = document.getElementById('login-alert-text');
    if (!alerta || !texto) return;

    // textContent y no innerHTML: el código viene de la URL.
    texto.textContent = MENSAJES[codigo] || 'No se pudo iniciar sesión. Inténtalo nuevamente.';
    alerta.classList.add('is-visible');

    // Se limpia la URL para que al recargar no reaparezca el error.
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  document.addEventListener('DOMContentLoaded', mostrarError);
})();
