/**
 * Repositorio del horario de atención.
 *
 * INTERFAZ PÚBLICA — es el contrato que deberá cumplir el futuro adaptador de
 * Neon, sin cambios en quien lo consume:
 *
 *   get()               -> Promise<Schedule>
 *   save(data, user)    -> Promise<Schedule>   (sella updatedAt / updatedBy)
 */

import path from 'node:path';
import config from '../config.js';
import { DEFAULT_SCHEDULE } from '../lib/defaults.js';
import { createJsonRepository } from './json-store.js';
import { createNeonScheduleStore } from './neon-store.js';

const DAY_KEYS = ['0', '1', '2', '3', '4', '5', '6'];

/**
 * Garantiza que el horario tenga los 7 días y una lista de excepciones válida,
 * aunque el archivo venga de una versión anterior o editado a mano.
 */
function normalizeSchedule(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const days = {};

  for (const key of DAY_KEYS) {
    const day = source.days?.[key] || DEFAULT_SCHEDULE.days[key];
    days[key] = {
      open: day.open || '09:00',
      close: day.close || '17:00',
      closed: Boolean(day.closed)
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
    timezone: source.timezone || DEFAULT_SCHEDULE.timezone,
    days,
    exceptions,
    updatedAt: source.updatedAt || null,
    updatedBy: source.updatedBy || null
  };
}

/**
 * El driver se elige aquí y en ningún otro lado. Ambos stores exponen la misma
 * pareja { get, save }, así que el resto del archivo no cambia según cuál esté
 * activo. Si alguna vez hubo que tocar rutas o esquemas para migrar, el
 * adaptador no estaba respetando el contrato.
 */
const store =
  config.storageDriver === 'neon'
    ? createNeonScheduleStore({ normalize: normalizeSchedule })
    : createJsonRepository({
        filePath: path.join(config.paths.data, 'schedule.json'),
        defaults: DEFAULT_SCHEDULE,
        normalize: normalizeSchedule
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
