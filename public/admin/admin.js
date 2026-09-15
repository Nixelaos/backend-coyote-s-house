/**
 * COYOTE'S HOUSE - PANEL DE ADMINISTRACIÓN
 *
 * JavaScript sin dependencias ni build. La política de seguridad del servidor
 * (CSP) prohíbe scripts y estilos en línea, así que todo el marcado dinámico se
 * construye con plantillas <template> y textContent, nunca con innerHTML.
 */

(function () {
  'use strict';

  // Lunes primero: es como una persona lee su semana, aunque Date.getDay()
  // empiece en domingo.
  var DIAS = [
    { key: '1', nombre: 'Lunes' },
    { key: '2', nombre: 'Martes' },
    { key: '3', nombre: 'Miércoles' },
    { key: '4', nombre: 'Jueves' },
    { key: '5', nombre: 'Viernes' },
    { key: '6', nombre: 'Sábado' },
    { key: '0', nombre: 'Domingo' }
  ];

  var DIA_CORTO = { 0: 'Dom', 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb' };
  var DIA_LARGO = {
    0: 'domingo',
    1: 'lunes',
    2: 'martes',
    3: 'miércoles',
    4: 'jueves',
    5: 'viernes',
    6: 'sábado'
  };
  var ORDEN_SEMANA = [1, 2, 3, 4, 5, 6, 0];

  // Píxeles por segundo del marquee según la velocidad elegida.
  var VELOCIDAD_PX_S = { slow: 55, normal: 90, fast: 150 };

  var MAX_MENSAJE = 200;

  /** Estado guardado en el servidor; sirve de referencia para detectar cambios. */
  var guardado = {
    schedule: null,
    banner: null
  };

  // ======================================================================
  // Utilidades
  // ======================================================================

  function $(id) {
    return document.getElementById(id);
  }

  function aMinutos(hora) {
    var m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hora || '');
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }

  /** Fecha calendario de hoy en la zona horaria del taller. */
  function ahoraEnSantiago() {
    var partes = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Santiago',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(new Date());

    var mapa = {};
    partes.forEach(function (p) {
      mapa[p.type] = p.value;
    });

    var indices = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    var hora = parseInt(mapa.hour, 10);
    if (!isFinite(hora) || hora === 24) hora = 0;

    return {
      fecha: mapa.year + '-' + mapa.month + '-' + mapa.day,
      dia: indices[mapa.weekday],
      minutos: hora * 60 + (parseInt(mapa.minute, 10) || 0)
    };
  }

  function sumarDias(fecha, cantidad) {
    var p = fecha.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]) + cantidad * 86400000);
    return {
      fecha:
        d.getUTCFullYear() +
        '-' +
        String(d.getUTCMonth() + 1).padStart(2, '0') +
        '-' +
        String(d.getUTCDate()).padStart(2, '0'),
      dia: d.getUTCDay()
    };
  }

  /**
   * Horario que rige una fecha concreta. Espeja getEffectiveDay del servidor
   * (src/lib/schedule-status.js): si cambias uno, cambia el otro.
   */
  function diaEfectivo(horario, dia, fecha) {
    var excepcion = horario.exceptions.filter(function (e) {
      return e.date === fecha;
    })[0];

    if (excepcion) {
      if (excepcion.closed) {
        return { closed: true, label: excepcion.label || '', esExcepcion: true };
      }
      if (excepcion.open && excepcion.close) {
        return {
          closed: false,
          open: excepcion.open,
          close: excepcion.close,
          label: excepcion.label || '',
          esExcepcion: true
        };
      }
    }

    var base = horario.days[dia];
    if (!base || base.closed) return { closed: true, label: '', esExcepcion: false };
    return { closed: false, open: base.open, close: base.close, label: '', esExcepcion: false };
  }

  /** Resumen agrupado: "Lun a Vie: 09:00 a 17:00 hrs". */
  function resumirHorario(horario) {
    var grupos = [];
    var actual = null;

    ORDEN_SEMANA.forEach(function (dia) {
      var d = horario.days[dia];
      if (!d || d.closed) {
        actual = null;
        return;
      }
      if (actual && actual.open === d.open && actual.close === d.close) {
        actual.dias.push(dia);
      } else {
        actual = { open: d.open, close: d.close, dias: [dia] };
        grupos.push(actual);
      }
    });

    if (grupos.length === 0) return 'Cerrado temporalmente';

    return grupos
      .map(function (g) {
        var etiqueta =
          g.dias.length === 1
            ? DIA_CORTO[g.dias[0]]
            : DIA_CORTO[g.dias[0]] + ' a ' + DIA_CORTO[g.dias[g.dias.length - 1]];
        return etiqueta + ': ' + g.open + ' a ' + g.close + ' hrs';
      })
      .join(' · ');
  }

  /** Estado ahora mismo. Espeja computeStatus del servidor. */
  function calcularEstado(horario) {
    var ahora = ahoraEnSantiago();
    var hoy = diaEfectivo(horario, ahora.dia, ahora.fecha);
    var resumen = resumirHorario(horario);

    if (!hoy.closed) {
      var abre = aMinutos(hoy.open);
      var cierra = aMinutos(hoy.close);
      if (abre !== null && cierra !== null) {
        if (ahora.minutos >= abre && ahora.minutos < cierra) {
          return { abierto: true, texto: 'Abierto hoy hasta ' + hoy.close, resumen: resumen };
        }
        if (ahora.minutos < abre) {
          return { abierto: false, texto: 'Cerrado (Abre ' + hoy.open + ' hrs)', resumen: resumen };
        }
      }
    }

    var proximo = null;
    for (var i = 1; i <= 7 && !proximo; i += 1) {
      var siguiente = sumarDias(ahora.fecha, i);
      var dia = diaEfectivo(horario, siguiente.dia, siguiente.fecha);
      if (!dia.closed) proximo = { dia: siguiente.dia, open: dia.open, offset: i };
    }

    var cuando = proximo ? (proximo.offset === 1 ? 'mañana' : DIA_LARGO[proximo.dia]) : null;

    // Igual que en el servidor: el motivo se informa aunque no haya proxima
    // apertura dentro de los proximos 7 dias.
    if (hoy.closed && hoy.esExcepcion && hoy.label) {
      return {
        abierto: false,
        texto: proximo
          ? 'Cerrado por ' + hoy.label + ' (Abre ' + cuando + ' ' + proximo.open + ')'
          : 'Cerrado por ' + hoy.label,
        resumen: resumen
      };
    }

    if (!proximo) return { abierto: false, texto: 'Cerrado temporalmente', resumen: resumen };

    return {
      abierto: false,
      texto: 'Cerrado (Abre ' + cuando + ' ' + proximo.open + ')',
      resumen: resumen
    };
  }

  // ======================================================================
  // Cliente HTTP
  // ======================================================================

  async function api(ruta, opciones) {
    var config = Object.assign({ credentials: 'same-origin' }, opciones || {});

    if (config.body) {
      config.headers = Object.assign({ 'Content-Type': 'application/json' }, config.headers);
      config.body = JSON.stringify(config.body);
    }

    var respuesta = await fetch(ruta, config);

    // Sesión caída: se vuelve al login con el motivo, en vez de dejar la
    // pantalla congelada con errores en consola.
    if (respuesta.status === 401 || respuesta.status === 403) {
      window.removeEventListener('beforeunload', avisarCambiosSinGuardar);
      window.location.href = 'login.html?error=sesion_expirada';
      throw new Error('sesion_terminada');
    }

    var datos = await respuesta.json().catch(function () {
      return {};
    });

    if (!respuesta.ok) {
      throw new Error(datos.message || 'No se pudo completar la operación.');
    }

    return datos;
  }

  // ======================================================================
  // Avisos
  // ======================================================================

  function avisar(mensaje, tipo) {
    var pila = $('toast-stack');
    var toast = document.createElement('div');
    toast.className = 'toast toast-' + (tipo || 'success');

    var icono = document.createElement('span');
    icono.setAttribute('aria-hidden', 'true');
    icono.textContent = tipo === 'error' ? '⚠️' : '✅';

    var texto = document.createElement('span');
    texto.textContent = mensaje;

    toast.appendChild(icono);
    toast.appendChild(texto);
    pila.appendChild(toast);

    setTimeout(function () {
      toast.classList.add('is-leaving');
      setTimeout(function () {
        toast.remove();
      }, 220);
    }, tipo === 'error' ? 6000 : 3500);
  }

  function formatearFecha(iso) {
    if (!iso) return 'Sin cambios registrados';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return (
      'Última actualización: ' +
      d.toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' }) +
      ' a las ' +
      d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
    );
  }

  // ======================================================================
  // Horario: pintar y leer el formulario
  // ======================================================================

  function pintarDias(horario) {
    var lista = $('day-list');
    var plantilla = $('tpl-day-row');
    lista.textContent = '';

    DIAS.forEach(function (dia) {
      var datos = horario.days[dia.key];
      var fila = plantilla.content.cloneNode(true).firstElementChild;

      fila.dataset.day = dia.key;
      fila.querySelector('.day-name').textContent = dia.nombre;

      var toggle = fila.querySelector('.day-toggle');
      var apertura = fila.querySelector('.day-open');
      var cierre = fila.querySelector('.day-close');

      toggle.checked = !datos.closed;
      apertura.value = datos.open;
      cierre.value = datos.close;

      aplicarEstadoFila(fila);

      toggle.addEventListener('change', function () {
        aplicarEstadoFila(fila);
        alCambiarHorario();
      });
      apertura.addEventListener('input', alCambiarHorario);
      cierre.addEventListener('input', alCambiarHorario);

      lista.appendChild(fila);
    });
  }

  function aplicarEstadoFila(fila) {
    var abierto = fila.querySelector('.day-toggle').checked;
    fila.classList.toggle('is-closed', !abierto);
    fila.querySelector('.switch-label').textContent = abierto ? 'Abierto' : 'Cerrado';
    fila.querySelector('.day-open').disabled = !abierto;
    fila.querySelector('.day-close').disabled = !abierto;
  }

  function agregarExcepcion(datos) {
    var plantilla = $('tpl-exception-row');
    var fila = plantilla.content.cloneNode(true).firstElementChild;

    var fecha = fila.querySelector('.exception-date');
    var cerrado = fila.querySelector('.exception-closed');
    var apertura = fila.querySelector('.exception-open');
    var cierre = fila.querySelector('.exception-close');
    var motivo = fila.querySelector('.exception-label');

    fecha.value = datos.date || '';
    cerrado.checked = datos.closed !== false;
    apertura.value = datos.open || '09:00';
    cierre.value = datos.close || '17:00';
    motivo.value = datos.label || '';

    aplicarEstadoExcepcion(fila);

    cerrado.addEventListener('change', function () {
      aplicarEstadoExcepcion(fila);
      alCambiarHorario();
    });

    [fecha, apertura, cierre, motivo].forEach(function (campo) {
      campo.addEventListener('input', alCambiarHorario);
    });

    fila.querySelector('.exception-remove').addEventListener('click', function () {
      fila.remove();
      actualizarVacioExcepciones();
      alCambiarHorario();
    });

    $('exception-list').appendChild(fila);
    actualizarVacioExcepciones();
  }

  function aplicarEstadoExcepcion(fila) {
    var cerrado = fila.querySelector('.exception-closed').checked;
    fila.classList.toggle('is-closed', cerrado);
    fila.querySelector('.switch-label').textContent = cerrado ? 'Cerrado' : 'Horario especial';
    fila.querySelector('.exception-open').disabled = cerrado;
    fila.querySelector('.exception-close').disabled = cerrado;
  }

  function actualizarVacioExcepciones() {
    var hay = $('exception-list').children.length > 0;
    $('exception-empty').hidden = hay;
  }

  /** Lee el formulario completo y devuelve el objeto que espera la API. */
  function leerHorario() {
    var days = {};

    Array.prototype.forEach.call(document.querySelectorAll('.day-row'), function (fila) {
      days[fila.dataset.day] = {
        open: fila.querySelector('.day-open').value,
        close: fila.querySelector('.day-close').value,
        closed: !fila.querySelector('.day-toggle').checked
      };
    });

    var exceptions = Array.prototype.map
      .call(document.querySelectorAll('.exception-row'), function (fila) {
        var cerrado = fila.querySelector('.exception-closed').checked;
        return {
          date: fila.querySelector('.exception-date').value,
          closed: cerrado,
          open: cerrado ? null : fila.querySelector('.exception-open').value,
          close: cerrado ? null : fila.querySelector('.exception-close').value,
          label: fila.querySelector('.exception-label').value.trim()
        };
      })
      // Una fila sin fecha está a medio llenar: no se envía.
      .filter(function (e) {
        return e.date;
      })
      .sort(function (a, b) {
        return a.date.localeCompare(b.date);
      });

    return { days: days, exceptions: exceptions };
  }

  function comparable(horario) {
    return JSON.stringify({ days: horario.days, exceptions: horario.exceptions });
  }

  // ======================================================================
  // Banner
  // ======================================================================

  function pintarBanner(banner) {
    $('banner-enabled').checked = banner.enabled;
    $('banner-message').value = banner.message;
    $('banner-link').value = banner.linkUrl;
    $('banner-starts').value = isoAFechaInput(banner.startsAt);
    $('banner-ends').value = isoAFechaInput(banner.endsAt);

    var radio = document.querySelector('input[name="banner-speed"][value="' + banner.speed + '"]');
    if (radio) radio.checked = true;

    actualizarEtiquetaBanner();
    actualizarContador();
  }

  function leerBanner() {
    var velocidad = document.querySelector('input[name="banner-speed"]:checked');
    var desde = $('banner-starts').value;
    var hasta = $('banner-ends').value;

    return {
      enabled: $('banner-enabled').checked,
      message: $('banner-message').value.trim(),
      linkUrl: $('banner-link').value.trim(),
      speed: velocidad ? velocidad.value : 'normal',
      // El navegador del administrador está en Chile: se toma el día completo
      // en su hora local y se convierte a UTC para guardarlo sin ambigüedad.
      startsAt: desde ? new Date(desde + 'T00:00:00').toISOString() : null,
      endsAt: hasta ? new Date(hasta + 'T23:59:59').toISOString() : null
    };
  }

  function isoAFechaInput(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function comparableBanner(banner) {
    return JSON.stringify({
      enabled: banner.enabled,
      message: banner.message,
      linkUrl: banner.linkUrl,
      speed: banner.speed,
      startsAt: banner.startsAt,
      endsAt: banner.endsAt
    });
  }

  function actualizarEtiquetaBanner() {
    var activo = $('banner-enabled').checked;
    $('banner-enabled-label').textContent = activo ? 'Activado' : 'Desactivado';
  }

  function actualizarContador() {
    var largo = $('banner-message').value.length;
    var contador = $('banner-count');
    contador.textContent = largo + ' / ' + MAX_MENSAJE;
    contador.classList.toggle('is-near-limit', largo > MAX_MENSAJE * 0.9);
  }

  // ======================================================================
  // Vista previa
  // ======================================================================

  function actualizarVistaPrevia() {
    var horario = leerHorario();
    var banner = leerBanner();

    var estado = calcularEstado(horario);

    var insignia = $('preview-status');
    insignia.className = 'status-badge ' + (estado.abierto ? 'open' : 'closed');
    $('preview-status-text').textContent = estado.texto;
    $('preview-summary').textContent = '🕒 ' + estado.resumen;

    pintarMarquee(banner);
  }

  function pintarMarquee(banner) {
    var contenedor = $('preview-banner');
    var pista = $('preview-track');

    var visible = banner.enabled && banner.message.length > 0;
    contenedor.hidden = !visible;
    if (!visible) return;

    // El mensaje se repite dos veces y la pista se desplaza -50%: así el
    // bucle es continuo, sin el salto en seco del <marquee> clásico.
    pista.textContent = '';
    for (var i = 0; i < 2; i += 1) {
      var item = document.createElement('span');
      item.className = 'preview-banner-item';
      item.textContent = banner.message;
      item.setAttribute('aria-hidden', i === 1 ? 'true' : 'false');
      pista.appendChild(item);
    }

    // La duración se deriva del ancho real para que la velocidad de lectura no
    // dependa del largo del texto: un mensaje corto no debe salir volando.
    requestAnimationFrame(function () {
      var pxPorSegundo = VELOCIDAD_PX_S[banner.speed] || VELOCIDAD_PX_S.normal;
      var recorrido = pista.scrollWidth / 2;
      if (recorrido > 0) {
        pista.style.setProperty('--marquee-duration', recorrido / pxPorSegundo + 's');
      }
    });
  }

  // ======================================================================
  // Cambios sin guardar
  // ======================================================================

  function alCambiarHorario() {
    // Un horario que aún no está publicado se puede guardar tal cual: los
    // valores iniciales pueden ser justo el horario correcto.
    var sucio =
      guardado.horarioSinPublicar || comparable(leerHorario()) !== comparable(guardado.schedule);
    $('schedule-save').disabled = !sucio;
    $('schedule-unsaved').classList.toggle('is-visible', sucio);
    actualizarVistaPrevia();
  }

  function alCambiarBanner() {
    var sucio = comparableBanner(leerBanner()) !== comparableBanner(guardado.banner);
    $('banner-save').disabled = !sucio;
    $('banner-unsaved').classList.toggle('is-visible', sucio);
    actualizarVistaPrevia();
  }

  function hayCambiosSinGuardar() {
    return !$('schedule-save').disabled || !$('banner-save').disabled;
  }

  function avisarCambiosSinGuardar(evento) {
    if (!hayCambiosSinGuardar()) return;
    evento.preventDefault();
    evento.returnValue = '';
  }

  // ======================================================================
  // Guardado
  // ======================================================================

  async function guardarHorario(evento) {
    evento.preventDefault();

    var boton = $('schedule-save');
    boton.disabled = true;
    boton.textContent = 'Guardando...';

    try {
      var respuesta = await api('/api/admin/schedule', { method: 'PUT', body: leerHorario() });

      guardado.schedule = respuesta.schedule;
      guardado.horarioSinPublicar = false;
      $('schedule-meta').textContent = formatearFecha(respuesta.schedule.updatedAt);
      $('schedule-unsaved').classList.remove('is-visible');

      avisar('Horario actualizado. Ya se ve en el sitio.', 'success');
    } catch (error) {
      if (error.message === 'sesion_terminada') return;
      avisar(error.message, 'error');
      boton.disabled = false;
    } finally {
      boton.textContent = 'Guardar horario';
      alCambiarHorario();
    }
  }

  async function guardarBanner(evento) {
    evento.preventDefault();

    var boton = $('banner-save');
    boton.disabled = true;
    boton.textContent = 'Guardando...';

    try {
      var respuesta = await api('/api/admin/banner', { method: 'PUT', body: leerBanner() });

      guardado.banner = respuesta.banner;
      $('banner-meta').textContent = formatearFecha(respuesta.banner.updatedAt);
      $('banner-unsaved').classList.remove('is-visible');

      avisar(
        respuesta.banner.enabled
          ? 'Banner publicado en el sitio.'
          : 'Banner guardado y desactivado.',
        'success'
      );
    } catch (error) {
      if (error.message === 'sesion_terminada') return;
      avisar(error.message, 'error');
      boton.disabled = false;
    } finally {
      boton.textContent = 'Guardar banner';
      alCambiarBanner();
    }
  }

  async function cerrarSesion() {
    try {
      await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } catch (error) {
      // Aunque falle la llamada conviene volver al login.
    }
    window.removeEventListener('beforeunload', avisarCambiosSinGuardar);
    window.location.href = 'login.html';
  }

  // ======================================================================
  // Arranque
  // ======================================================================

  async function iniciar() {
    try {
      var usuario = await api('/auth/me');

      $('user-name').textContent = usuario.name || usuario.email;
      if (usuario.picture) {
        $('user-avatar').src = usuario.picture;
        $('user-avatar').alt = 'Foto de ' + (usuario.name || usuario.email);
      }
      $('user-chip').hidden = false;

      var horario = await api('/api/admin/schedule');
      var banner = await api('/api/admin/banner');

      guardado.schedule = horario.schedule;
      guardado.banner = banner.banner;
      // Sin horario guardado (o con el archivo dañado) el servidor manda los
      // valores iniciales: el sitio no muestra nada hasta que se guarden.
      guardado.horarioSinPublicar = horario.published === false;

      pintarDias(horario.schedule);
      horario.schedule.exceptions.forEach(agregarExcepcion);
      actualizarVacioExcepciones();
      pintarBanner(banner.banner);

      $('schedule-meta').textContent = guardado.horarioSinPublicar
        ? 'Aún no se muestra en el sitio: revisa los días y guarda para publicarlo.'
        : formatearFecha(horario.schedule.updatedAt);
      $('banner-meta').textContent = formatearFecha(banner.banner.updatedAt);

      $('loading').hidden = true;
      $('app').hidden = false;

      // Pinta la vista previa y, si el horario no está publicado, deja el
      // botón de guardar activo.
      alCambiarHorario();

      // El badge de estado cambia con el reloj aunque nadie toque nada.
      setInterval(actualizarVistaPrevia, 60000);
    } catch (error) {
      if (error.message === 'sesion_terminada') return;
      $('loading').textContent =
        'No se pudo cargar la configuración: ' + error.message + '. Recarga la página para reintentar.';
    }
  }

  function conectarEventos() {
    $('schedule-form').addEventListener('submit', guardarHorario);
    $('banner-form').addEventListener('submit', guardarBanner);
    $('logout-button').addEventListener('click', cerrarSesion);

    $('add-exception').addEventListener('click', function () {
      agregarExcepcion({ date: '', closed: true, label: '' });
      alCambiarHorario();
    });

    $('banner-enabled').addEventListener('change', function () {
      actualizarEtiquetaBanner();
      alCambiarBanner();
    });

    $('banner-message').addEventListener('input', function () {
      actualizarContador();
      alCambiarBanner();
    });

    ['banner-link', 'banner-starts', 'banner-ends'].forEach(function (id) {
      $(id).addEventListener('input', alCambiarBanner);
    });

    Array.prototype.forEach.call(
      document.querySelectorAll('input[name="banner-speed"]'),
      function (radio) {
        radio.addEventListener('change', alCambiarBanner);
      }
    );

    window.addEventListener('beforeunload', avisarCambiosSinGuardar);
  }

  document.addEventListener('DOMContentLoaded', function () {
    conectarEventos();
    iniciar();
  });
})();
