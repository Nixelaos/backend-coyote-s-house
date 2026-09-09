/**
 * Adaptador de almacenamiento sobre Postgres (Neon).
 *
 * Cumple EXACTAMENTE el mismo contrato que json-store.js:
 *
 *   get()      -> Promise<Schedule | Banner>
 *   save(data) -> Promise<Schedule | Banner>
 *
 * El sellado de updatedAt / updatedBy lo sigue haciendo el repositorio que
 * envuelve al store, igual que con JSON; aquí solo se persisten esos campos.
 * Gracias a eso las rutas, los esquemas y el panel no se enteran del cambio.
 *
 * Se usa el driver HTTP (neon) y no un Pool por WebSocket a propósito:
 * sql.transaction([...]) cubre todo lo que hace falta —los enunciados de cada
 * guardado se conocen de antemano— sin arrastrar la dependencia `ws`, que sería
 * necesaria en Node 20 porque todavía no trae WebSocket global.
 */

import { neon } from '@neondatabase/serverless';
import config from '../config.js';
import { DEFAULT_SCHEDULE, DEFAULT_BANNER } from '../lib/defaults.js';

const DAY_KEYS = ['0', '1', '2', '3', '4', '5', '6'];

let cliente = null;

/**
 * Conexión perezosa: config.js se importa siempre, incluso con el driver JSON,
 * y no tiene sentido crear un cliente de Postgres que nadie va a usar.
 */
function db() {
  if (!cliente) {
    if (!config.databaseUrl) {
      throw new Error('STORAGE_DRIVER=neon requiere DATABASE_URL en el entorno.');
    }
    cliente = neon(config.databaseUrl);
  }
  return cliente;
}

/**
 * timestamptz -> string ISO, que es lo que devuelve el store de JSON.
 * Sin esto el driver entregaría objetos Date y la forma de la API pública
 * cambiaría según el driver configurado.
 */
function aIso(valor) {
  if (!valor) return null;
  return valor instanceof Date ? valor.toISOString() : String(valor);
}

/**
 * Una fila recién sembrada trae updated_at = now() por el DEFAULT de la tabla,
 * pero nadie la editó todavía. El store de JSON en ese caso devuelve
 * updatedAt: null, así que se replica: sin updated_by no hubo edición humana.
 */
function selloDeEdicion(fila) {
  if (!fila || !fila.updated_by) return { updatedAt: null, updatedBy: null };
  return { updatedAt: aIso(fila.updated_at), updatedBy: fila.updated_by };
}

// --- Horario -----------------------------------------------------------

async function leerHorario() {
  const sql = db();

  const [dias, excepciones] = await Promise.all([
    sql`select day_index, open_time, close_time, closed, updated_at, updated_by
          from schedule_days
         order by day_index`,
    // to_char y no la columna cruda: el driver convierte `date` en un Date de la
    // zona local, que puede correr la fecha un día entero. El sitio y el panel
    // hablan siempre en 'YYYY-MM-DD'.
    sql`select to_char(exception_date, 'YYYY-MM-DD') as date,
               closed, open_time, close_time, label
          from schedule_exceptions
         order by exception_date asc`
  ]);

  if (dias.length === 0) return null;

  const days = {};
  for (const fila of dias) {
    days[String(fila.day_index)] = {
      open: fila.open_time,
      close: fila.close_time,
      closed: Boolean(fila.closed)
    };
  }

  // Un guardado escribe los 7 días con el mismo sello, así que basta el más reciente.
  const masReciente = dias.reduce(
    (acc, fila) => (acc && acc.updated_at >= fila.updated_at ? acc : fila),
    null
  );

  return {
    // La zona horaria no vive en la base: es una constante del taller.
    timezone: DEFAULT_SCHEDULE.timezone,
    days,
    exceptions: excepciones.map((fila) => ({
      date: fila.date,
      closed: Boolean(fila.closed),
      open: fila.open_time || null,
      close: fila.close_time || null,
      label: fila.label || ''
    })),
    ...selloDeEdicion(masReciente)
  };
}

async function sembrarHorario() {
  const sql = db();
  await sql.transaction(
    DAY_KEYS.map((key) => {
      const dia = DEFAULT_SCHEDULE.days[key];
      return sql`insert into schedule_days (day_index, open_time, close_time, closed)
                 values (${Number(key)}, ${dia.open}, ${dia.close}, ${dia.closed})
                 on conflict (day_index) do nothing`;
    })
  );
}

/**
 * @param {object} options
 * @param {(raw: object) => object} options.normalize El mismo saneado que aplica el driver JSON.
 */
export function createNeonScheduleStore({ normalize } = {}) {
  const apply = typeof normalize === 'function' ? normalize : (value) => value;

  return {
    async get() {
      const actual = await leerHorario();
      if (actual) return apply(actual);

      // Primer arranque contra una base vacía: se siembran los 7 días.
      await sembrarHorario();
      return apply((await leerHorario()) || structuredClone(DEFAULT_SCHEDULE));
    },

    async save(data) {
      const horario = apply(data);
      const sql = db();
      const usuario = horario.updatedBy || 'desconocido';
      const sello = horario.updatedAt || new Date().toISOString();

      // Todo en una sola transacción: hoy el JSON se escribe de forma atómica y
      // esa garantía no se puede perder. Un fallo a medio guardar dejaría el
      // sitio con unos días nuevos y otros viejos.
      const enunciados = [];

      for (const key of DAY_KEYS) {
        const dia = horario.days[key];
        enunciados.push(sql`
          insert into schedule_days (day_index, open_time, close_time, closed, updated_at, updated_by)
          values (${Number(key)}, ${dia.open}, ${dia.close}, ${dia.closed}, ${sello}, ${usuario})
          on conflict (day_index) do update set
            open_time  = excluded.open_time,
            close_time = excluded.close_time,
            closed     = excluded.closed,
            updated_at = excluded.updated_at,
            updated_by = excluded.updated_by
        `);
      }

      // Las excepciones se reemplazan por completo: el panel envía siempre la
      // lista entera, así que borrar y reinsertar es lo que refleja su intención.
      enunciados.push(sql`delete from schedule_exceptions`);

      for (const excepcion of horario.exceptions) {
        enunciados.push(sql`
          insert into schedule_exceptions
            (exception_date, closed, open_time, close_time, label, updated_at, updated_by)
          values (${excepcion.date}::date, ${excepcion.closed}, ${excepcion.open},
                  ${excepcion.close}, ${excepcion.label}, ${sello}, ${usuario})
          on conflict (exception_date) do update set
            closed     = excluded.closed,
            open_time  = excluded.open_time,
            close_time = excluded.close_time,
            label      = excluded.label,
            updated_at = excluded.updated_at,
            updated_by = excluded.updated_by
        `);
      }

      enunciados.push(sql`
        insert into audit_log (entity, payload, changed_by, changed_at)
        values ('schedule', ${JSON.stringify(horario)}::jsonb, ${usuario}, ${sello})
      `);

      await sql.transaction(enunciados);
      return horario;
    }
  };
}

// --- Banner ------------------------------------------------------------

async function leerBanner() {
  const sql = db();
  const filas = await sql`
    select enabled, message, link_url, speed, starts_at, ends_at, updated_at, updated_by
      from banners
     where id = 1
  `;
  if (filas.length === 0) return null;

  const fila = filas[0];
  return {
    enabled: Boolean(fila.enabled),
    message: fila.message || '',
    linkUrl: fila.link_url || '',
    speed: fila.speed,
    startsAt: aIso(fila.starts_at),
    endsAt: aIso(fila.ends_at),
    ...selloDeEdicion(fila)
  };
}

export function createNeonBannerStore({ normalize } = {}) {
  const apply = typeof normalize === 'function' ? normalize : (value) => value;

  return {
    async get() {
      const actual = await leerBanner();
      if (actual) return apply(actual);

      const sql = db();
      await sql`
        insert into banners (id, enabled, message, link_url, speed)
        values (1, ${DEFAULT_BANNER.enabled}, ${DEFAULT_BANNER.message},
                ${DEFAULT_BANNER.linkUrl}, ${DEFAULT_BANNER.speed})
        on conflict (id) do nothing
      `;
      return apply((await leerBanner()) || structuredClone(DEFAULT_BANNER));
    },

    async save(data) {
      const banner = apply(data);
      const sql = db();
      const usuario = banner.updatedBy || 'desconocido';
      const sello = banner.updatedAt || new Date().toISOString();

      await sql.transaction([
        sql`
          insert into banners (id, enabled, message, link_url, speed, starts_at, ends_at, updated_at, updated_by)
          values (1, ${banner.enabled}, ${banner.message}, ${banner.linkUrl}, ${banner.speed},
                  ${banner.startsAt}, ${banner.endsAt}, ${sello}, ${usuario})
          on conflict (id) do update set
            enabled    = excluded.enabled,
            message    = excluded.message,
            link_url   = excluded.link_url,
            speed      = excluded.speed,
            starts_at  = excluded.starts_at,
            ends_at    = excluded.ends_at,
            updated_at = excluded.updated_at,
            updated_by = excluded.updated_by
        `,
        sql`
          insert into audit_log (entity, payload, changed_by, changed_at)
          values ('banner', ${JSON.stringify(banner)}::jsonb, ${usuario}, ${sello})
        `
      ]);

      return banner;
    }
  };
}
