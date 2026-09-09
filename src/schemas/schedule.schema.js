/**
 * Esquemas de validación del horario (JSON Schema nativo de Fastify).
 *
 * El esquema cubre la FORMA de los datos. Las reglas de negocio que JSON Schema
 * no puede expresar (que el cierre sea posterior a la apertura, por ejemplo)
 * viven en validateScheduleRules y devuelven un 400 con un mensaje en español,
 * no un 500.
 */

import { toMinutes, DAY_LONG } from '../lib/schedule-status.js';

const TIME_PATTERN = '^([01][0-9]|2[0-3]):[0-5][0-9]$';
const DATE_PATTERN = '^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$';

const daySchema = {
  type: 'object',
  required: ['open', 'close', 'closed'],
  additionalProperties: false,
  properties: {
    open: { type: 'string', pattern: TIME_PATTERN },
    close: { type: 'string', pattern: TIME_PATTERN },
    closed: { type: 'boolean' }
  }
};

const daysSchema = {
  type: 'object',
  required: ['0', '1', '2', '3', '4', '5', '6'],
  additionalProperties: false,
  properties: {
    0: daySchema,
    1: daySchema,
    2: daySchema,
    3: daySchema,
    4: daySchema,
    5: daySchema,
    6: daySchema
  }
};

const exceptionSchema = {
  type: 'object',
  required: ['date'],
  additionalProperties: false,
  properties: {
    date: { type: 'string', pattern: DATE_PATTERN },
    closed: { type: 'boolean', default: true },
    open: { type: ['string', 'null'], pattern: TIME_PATTERN },
    close: { type: ['string', 'null'], pattern: TIME_PATTERN },
    label: { type: 'string', maxLength: 60 }
  }
};

export const scheduleBodySchema = {
  type: 'object',
  required: ['days'],
  additionalProperties: false,
  properties: {
    timezone: { type: 'string', maxLength: 64 },
    days: daysSchema,
    exceptions: {
      type: 'array',
      maxItems: 60,
      items: exceptionSchema
    }
  }
};

/**
 * Reglas de negocio del horario.
 * @returns {string[]} lista de errores legibles; vacía si todo está bien.
 */
export function validateScheduleRules(schedule) {
  const errors = [];

  for (const [key, day] of Object.entries(schedule.days || {})) {
    if (day.closed) continue; // Un día cerrado no necesita horas coherentes.

    const open = toMinutes(day.open);
    const close = toMinutes(day.close);

    if (open === null || close === null) {
      errors.push(`El horario del ${DAY_LONG[key]} tiene una hora inválida.`);
      continue;
    }
    if (close <= open) {
      errors.push(`El ${DAY_LONG[key]} cierra a las ${day.close}, que no es posterior a la apertura (${day.open}).`);
    }
  }

  const seenDates = new Set();

  for (const exception of schedule.exceptions || []) {
    if (seenDates.has(exception.date)) {
      errors.push(`Hay más de un día especial con la fecha ${exception.date}.`);
    }
    seenDates.add(exception.date);

    // Una fecha como 2026-02-31 pasa el patrón pero no existe en el calendario.
    const [year, month, day] = exception.date.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
      errors.push(`La fecha ${exception.date} no existe en el calendario.`);
    }

    if (exception.closed === false) {
      const open = toMinutes(exception.open);
      const close = toMinutes(exception.close);
      if (open === null || close === null) {
        errors.push(`El día especial ${exception.date} está marcado como abierto pero no tiene horario.`);
      } else if (close <= open) {
        errors.push(`El día especial ${exception.date} cierra antes de abrir.`);
      }
    }
  }

  return errors;
}
