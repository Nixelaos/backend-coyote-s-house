/**
 * Verifica que site-config.js (navegador) y schedule-status.js (servidor)
 * lleguen SIEMPRE al mismo resultado.
 *
 * Son dos implementaciones separadas por necesidad: el sitio publico no puede
 * importar codigo del backend. Si divergen, el badge del sitio contradice a la
 * API y nadie se entera hasta que un cliente llega al taller cerrado.
 *
 * Se barre una semana completa en pasos de 90 minutos con el reloj simulado,
 * para cubrir las ramas "antes de abrir", "abierto" y "despues de cerrar" que
 * de otro modo dependerian de la hora real de ejecucion.
 */

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeStatus, buildSummary } from '../src/lib/schedule-status.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

// El sitio publico es un proyecto hermano de este backend.
const RUTA_SITE_CONFIG = path.resolve(
  AQUI,
  '..',
  '..',
  'coyote-s-house',
  'js',
  'lib',
  'site-config.js'
);

if (!fs.existsSync(RUTA_SITE_CONFIG)) {
  console.log('  AVISO: no se encontro el sitio publico en ../coyote-s-house; se omite la prueba.');
  process.exit(0);
}

const FUENTE = fs.readFileSync(RUTA_SITE_CONFIG, 'utf8');

/** Date con "ahora" congelado; el resto del comportamiento intacto. */
function DateCongelado(instante) {
  return class extends Date {
    constructor(...args) {
      if (args.length === 0) super(instante);
      else super(...args);
    }
    static now() {
      return instante;
    }
  };
}

/**
 * Evalua site-config.js en un entorno de navegador minimo con el reloj fijo
 * y el horario indicado ya cargado como respaldo.
 */
function crearCliente(instante, horario) {
  const FakeDate = DateCongelado(instante);

  const almacen = {
    // La cache se siembra con el horario del escenario: asi el modulo lo toma
    // sin depender de la red.
    'coyote:site-config': JSON.stringify({
      t: instante,
      v: { schedule: horario, banner: { enabled: false, message: '', linkUrl: '', speed: 'normal' } }
    })
  };

  const window = {
    location: { hostname: 'localhost' },
    sessionStorage: {
      getItem: (k) => (k in almacen ? almacen[k] : null),
      setItem: (k, v) => {
        almacen[k] = v;
      }
    },
    addEventListener() {},
    dispatchEvent() {},
    console: { info() {} },
    CustomEvent: class {
      constructor(tipo, init) {
        this.type = tipo;
        this.detail = init && init.detail;
      }
    },
    // Sin red: el modulo se queda con lo que trae la cache.
    fetch: () => Promise.reject(new Error('sin red')),
    AbortController: globalThis.AbortController,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    Intl: globalThis.Intl,
    Date: FakeDate
  };

  window.window = window;

  const contexto = vm.createContext({
    window,
    document: { querySelector: () => null },
    fetch: window.fetch,
    AbortController: globalThis.AbortController,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    CustomEvent: window.CustomEvent,
    Intl: globalThis.Intl,
    Date: FakeDate,
    console: { info() {} }
  });

  vm.runInContext(FUENTE, contexto);
  return window.CoyoteSiteConfig;
}

// --- Escenarios -------------------------------------------------------------

const dia = (open, close, closed = false) => ({ open, close, closed });

const SEMANA_NORMAL = {
  0: dia('09:00', '13:00', true),
  1: dia('09:00', '17:00'),
  2: dia('09:00', '17:00'),
  3: dia('09:00', '17:00'),
  4: dia('09:00', '17:00'),
  5: dia('09:00', '17:00'),
  6: dia('09:00', '13:00', true)
};

/** Fecha calendario en Santiago para un instante dado. */
function fechaSantiago(instante, offsetDias = 0) {
  const texto = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(instante));
  const [y, m, d] = texto.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + offsetDias * 86400000).toISOString().slice(0, 10);
}

function construirEscenarios(instante) {
  return [
    { nombre: 'horario actual Lun-Vie 09-17', days: SEMANA_NORMAL, exceptions: [] },
    {
      nombre: 'con sabado corto y viernes reducido',
      days: {
        ...SEMANA_NORMAL,
        5: dia('09:00', '15:00'),
        6: dia('10:00', '13:00')
      },
      exceptions: []
    },
    {
      nombre: 'cerrado toda la semana',
      days: Object.fromEntries(
        Object.entries(SEMANA_NORMAL).map(([k, v]) => [k, { ...v, closed: true }])
      ),
      exceptions: []
    },
    {
      nombre: 'solo miercoles abierto',
      days: {
        ...Object.fromEntries(
          Object.entries(SEMANA_NORMAL).map(([k, v]) => [k, { ...v, closed: true }])
        ),
        3: dia('08:30', '18:45')
      },
      exceptions: []
    },
    {
      nombre: 'feriado HOY con motivo',
      days: SEMANA_NORMAL,
      exceptions: [{ date: fechaSantiago(instante, 0), closed: true, label: 'Fiestas Patrias' }]
    },
    {
      nombre: 'feriado MANANA',
      days: SEMANA_NORMAL,
      exceptions: [{ date: fechaSantiago(instante, 1), closed: true, label: 'Feriado' }]
    },
    {
      nombre: 'HOY con horario especial 10-12',
      days: SEMANA_NORMAL,
      exceptions: [
        { date: fechaSantiago(instante, 0), closed: false, open: '10:00', close: '12:00', label: 'Inventario' }
      ]
    },
    {
      nombre: 'vacaciones de 9 dias (sin proxima apertura)',
      days: SEMANA_NORMAL,
      exceptions: Array.from({ length: 9 }, (_, i) => ({
        date: fechaSantiago(instante, i),
        closed: true,
        label: 'Vacaciones'
      }))
    },
    {
      nombre: 'jornada nocturna corta 23:00-23:59',
      days: { ...SEMANA_NORMAL, 1: dia('23:00', '23:59'), 2: dia('23:00', '23:59') },
      exceptions: []
    },
    {
      nombre: 'apertura a medianoche 00:00-06:00',
      days: Object.fromEntries(
        Object.keys(SEMANA_NORMAL).map((k) => [k, dia('00:00', '06:00')])
      ),
      exceptions: []
    }
  ];
}

// --- Barrido ---------------------------------------------------------------

// Miercoles 2026-09-09 a medianoche UTC, avanzando 90 minutos por paso
// durante 8 dias: cubre todos los dias de la semana y todos los tramos.
const INICIO = Date.UTC(2026, 8, 9, 0, 0, 0);
const PASO_MS = 90 * 60 * 1000;
const PASOS = Math.ceil((8 * 24 * 60) / 90);

let comparaciones = 0;
let fallos = 0;
const ejemplos = new Map();

for (let paso = 0; paso < PASOS; paso += 1) {
  const instante = INICIO + paso * PASO_MS;

  for (const escenario of construirEscenarios(instante)) {
    const horario = {
      timezone: 'America/Santiago',
      days: escenario.days,
      exceptions: escenario.exceptions
    };

    const servidor = computeStatus(horario, new Date(instante));
    const resumenServidor = buildSummary(horario);

    const cliente = crearCliente(instante, horario);
    const navegador = cliente.getStatus();
    const resumenNavegador = cliente.getSummary();

    comparaciones += 1;

    const iguales =
      servidor.isOpen === navegador.isOpen &&
      servidor.text === navegador.text &&
      resumenServidor === resumenNavegador;

    if (!iguales) {
      fallos += 1;
      if (fallos <= 8) {
        const local = new Intl.DateTimeFormat('es-CL', {
          timeZone: 'America/Santiago',
          weekday: 'short',
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        }).format(new Date(instante));
        console.log(`  FALLA [${local}] ${escenario.nombre}`);
        console.log(`         servidor  : ${servidor.isOpen} "${servidor.text}" | ${resumenServidor}`);
        console.log(`         navegador : ${navegador.isOpen} "${navegador.text}" | ${resumenNavegador}`);
      }
    } else if (!ejemplos.has(escenario.nombre + navegador.text)) {
      ejemplos.set(escenario.nombre + navegador.text, {
        escenario: escenario.nombre,
        texto: navegador.text
      });
    }
  }
}

console.log('\n--- Textos distintos producidos (muestra) ---');
let mostrados = 0;
for (const e of ejemplos.values()) {
  if (mostrados >= 16) break;
  console.log(`  ${e.escenario.padEnd(42)} -> "${e.texto}"`);
  mostrados += 1;
}

console.log(`\n${comparaciones} comparaciones, ${fallos} divergencias`);
process.exit(fallos > 0 ? 1 : 0);
