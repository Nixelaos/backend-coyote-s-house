/**
 * Repositorio del horario de atención.
 *
 * El almacenamiento es un archivo JSON (DATA_DIR/schedule.json) y es la única
 * copia: no hay base de datos. Quien lo consume solo ve:
 *
 *   get()               -> Promise<Schedule>   (lanza si falta, está dañado o no es válido)
 *   save(data, user)    -> Promise<Schedule>   (sella updatedAt / updatedBy)
 */

import path from 'node:path';
import config from '../config.js';
import { DAY_LONG } from '../lib/schedule-status.js';
import { validateScheduleRules } from '../schemas/schedule.schema.js';
import { createJsonRepository } from './json-store.js';

const DAY_KEYS = ['0', '1', '2', '3', '4', '5', '6'];

function invalidSchedule(detail) {
  const error = new Error(`El horario guardado no es válido: ${detail}`);
  error.code = 'EINVALIDDATA';
  return error;
}

/**
 * Da forma al horario: los 7 días y una lista de excepciones ordenada.
 *
 * Un día que falta NO se rellena con un horario por defecto, ni un día abierto
 * sin horas recibe unas inventadas: eso publicaría algo que nadie guardó. El
 * panel siempre envía los 7 días (lo exige el esquema), así que esto solo
 * salta con un archivo editado a mano.
 */
function normalizeSchedule(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const days = {};

  for (const key of DAY_KEYS) {
    const day = source.days?.[key];

    if (!day || typeof day !== 'object') {
      throw invalidSchedule(`falta el ${DAY_LONG[key]}.`);
    }

    const closed = Boolean(day.closed);
    days[key] = {
      // En un día cerrado las horas no se muestran en ningún lado: solo
      // rellenan el formulario del panel para cuando se vuelva a abrir.
      open: closed ? day.open || '09:00' : day.open,
      close: closed ? day.close || '17:00' : day.close,
      closed
    };
  }

  const exceptions = Array.isArray(source.exceptions)
    ? source.exceptions
        .filter((item) => item && typeof item.date === 'string')
        .map((item) => ({
          date: item.date,
          closed: item.closed !== false,
          open: item.open || null,
          close: item.close || null,
          label: (item.label || '').trim()
        }))
        // Orden cronológico: así el panel las lista de la más próxima a la más lejana.
        .sort((a, b) => a.date.localeCompare(b.date))
    : [];

  return {
    timezone: source.timezone || config.timezone,
    days,
    exceptions,
    updatedAt: source.updatedAt || null,
    updatedBy: source.updatedBy || null
  };
}

/**
 * Lectura del archivo: además de dar forma, exige lo mismo que el panel al
 * guardar. Un día abierto sin horas o que cierra antes de abrir no se publica:
 * se lanza EINVALIDDATA y la API pública responde 503.
 */
function parseStoredSchedule(raw) {
  const schedule = normalizeSchedule(raw);
  const errors = validateScheduleRules(schedule);
  if (errors.length > 0) throw invalidSchedule(errors.join(' '));
  return schedule;
}

const store = createJsonRepository({
  filePath: path.join(config.paths.data, 'schedule.json'),
  normalize: parseStoredSchedule
});

export const scheduleRepository = {
  get() {
    return store.get();
  },

  save(data, user) {
    return store.save({
      ...data,
      updatedAt: new Date().toISOString(),
      updatedBy: user?.email || 'desconocido'
    });
  }
};

export { normalizeSchedule };
