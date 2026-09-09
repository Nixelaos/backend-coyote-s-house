/**
 * Cálculo de estado de atención (abierto / cerrado) en la zona horaria del taller.
 *
 * Toda la aritmética se hace sobre minutos desde medianoche y sobre fechas
 * calendario "YYYY-MM-DD", nunca sobre timestamps locales del servidor: el
 * servidor puede estar en cualquier parte del mundo, el taller está en Santiago.
 *
 * IMPORTANTE: este archivo tiene un gemelo en el sitio público
 * (coyote-s-house/js/lib/site-config.js). Si cambias la lógica de estado aquí,
 * cámbiala también allá para que el badge no se contradiga con la API.
 */

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const DAY_SHORT = {
  0: 'Dom',
  1: 'Lun',
  2: 'Mar',
  3: 'Mié',
  4: 'Jue',
  5: 'Vie',
  6: 'Sáb'
};

const DAY_LONG = {
  0: 'domingo',
  1: 'lunes',
  2: 'martes',
  3: 'miércoles',
  4: 'jueves',
  5: 'viernes',
  6: 'sábado'
};

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const MS_PER_DAY = 86400000;

/** "09:30" -> 570. Devuelve null si el formato no es válido. */
export function toMinutes(time) {
  if (typeof time !== 'string') return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Momento actual expresado en la zona horaria indicada.
 * Devuelve { dateStr, dayIndex, minutes } donde dateStr es la fecha calendario
 * local del taller, no la del servidor.
 */
export function getNowInTimezone(timezone = 'America/Santiago', reference = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(reference);

    const map = {};
    for (const part of parts) map[part.type] = part.value;

    // Algunas versiones de ICU devuelven "24" a la medianoche con hour12:false.
    let hour = Number.parseInt(map.hour, 10);
    if (!Number.isFinite(hour) || hour === 24) hour = 0;
    const minute = Number.parseInt(map.minute, 10) || 0;

    return {
      dateStr: `${map.year}-${map.month}-${map.day}`,
      dayIndex: WEEKDAY_INDEX[map.weekday] ?? reference.getDay(),
      minutes: hour * 60 + minute
    };
  } catch {
    // Si Intl no soporta la zona horaria, se degrada a la hora local del proceso.
    const yyyy = reference.getFullYear();
    const mm = String(reference.getMonth() + 1).padStart(2, '0');
    const dd = String(reference.getDate()).padStart(2, '0');
    return {
      dateStr: `${yyyy}-${mm}-${dd}`,
      dayIndex: reference.getDay(),
      minutes: reference.getHours() * 60 + reference.getMinutes()
    };
  }
}

/** Suma días a una fecha calendario "YYYY-MM-DD" sin tocar zonas horarias. */
function addDays(dateStr, amount) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day) + amount * MS_PER_DAY);
  const yyyy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(shifted.getUTCDate()).padStart(2, '0');
  return { dateStr: `${yyyy}-${mm}-${dd}`, dayIndex: shifted.getUTCDay() };
}

/**
 * Horario que realmente rige una fecha: la excepción, si existe, le gana
 * siempre al horario semanal.
 */
export function getEffectiveDay(schedule, dayIndex, dateStr) {
  const exception = Array.isArray(schedule.exceptions)
    ? schedule.exceptions.find((item) => item && item.date === dateStr)
    : null;

  if (exception) {
    if (exception.closed) {
      return { closed: true, open: null, close: null, label: exception.label || '', isException: true };
    }
    if (exception.open && exception.close) {
      return {
        closed: false,
        open: exception.open,
        close: exception.close,
        label: exception.label || '',
        isException: true
      };
    }
  }

  const day = schedule.days?.[dayIndex] || schedule.days?.[String(dayIndex)];
  if (!day || day.closed) {
    return { closed: true, open: null, close: null, label: '', isException: false };
  }

  return { closed: false, open: day.open, close: day.close, label: '', isException: false };
}

/**
 * Busca la próxima apertura dentro de los próximos 7 días.
 * Devuelve null si el taller está cerrado toda la semana.
 */
function findNextOpening(schedule, today) {
  for (let offset = 1; offset <= 7; offset += 1) {
    const next = addDays(today.dateStr, offset);
    const day = getEffectiveDay(schedule, next.dayIndex, next.dateStr);
    if (!day.closed) {
      return { ...next, ...day, offset };
    }
  }
  return null;
}

/** Frase corta que describe cuándo vuelve a abrir. */
function describeNextOpening(next) {
  if (!next) return 'Cerrado temporalmente';
  if (next.offset === 1) return `Cerrado (Abre mañana ${next.open})`;
  return `Cerrado (Abre ${DAY_LONG[next.dayIndex]} ${next.open})`;
}

/**
 * Resumen legible del horario semanal, agrupando días consecutivos con el
 * mismo tramo: "Lun a Vie: 09:00 a 17:00 hrs · Sáb: 09:00 a 13:00 hrs".
 */
export function buildSummary(schedule) {
  const groups = [];
  let current = null;

  for (const dayIndex of DAY_ORDER) {
    const day = schedule.days?.[dayIndex] || schedule.days?.[String(dayIndex)];
    const isOpenDay = day && !day.closed;

    if (!isOpenDay) {
      current = null; // Un día cerrado corta la racha.
      continue;
    }

    if (current && current.open === day.open && current.close === day.close) {
      current.days.push(dayIndex);
    } else {
      current = { open: day.open, close: day.close, days: [dayIndex] };
      groups.push(current);
    }
  }

  if (groups.length === 0) return 'Cerrado temporalmente';

  return groups
    .map((group) => {
      const first = DAY_SHORT[group.days[0]];
      const last = DAY_SHORT[group.days[group.days.length - 1]];
      const label = group.days.length === 1 ? first : `${first} a ${last}`;
      return `${label}: ${group.open} a ${group.close} hrs`;
    })
    .join(' · ');
}

/**
 * Estado completo del taller en este instante.
 * @returns {{isOpen: boolean, text: string, summary: string, today: object}}
 */
export function computeStatus(schedule, reference = new Date()) {
  const timezone = schedule.timezone || 'America/Santiago';
  const now = getNowInTimezone(timezone, reference);
  const today = getEffectiveDay(schedule, now.dayIndex, now.dateStr);
  const summary = buildSummary(schedule);

  const base = {
    summary,
    today: {
      date: now.dateStr,
      dayIndex: now.dayIndex,
      closed: today.closed,
      open: today.open,
      close: today.close,
      label: today.label
    }
  };

  if (!today.closed) {
    const openMinutes = toMinutes(today.open);
    const closeMinutes = toMinutes(today.close);

    if (openMinutes !== null && closeMinutes !== null) {
      if (now.minutes >= openMinutes && now.minutes < closeMinutes) {
        return { ...base, isOpen: true, text: `Abierto hoy hasta ${today.close}` };
      }
      if (now.minutes < openMinutes) {
        return { ...base, isOpen: false, text: `Cerrado (Abre ${today.open} hrs)` };
      }
    }
  }

  const next = findNextOpening(schedule, now);
  let text = describeNextOpening(next);

  // Si hoy está cerrado por un feriado con nombre, se explica el motivo.
  if (today.closed && today.isException && today.label) {
    text = next
      ? `Cerrado por ${today.label} (Abre ${next.offset === 1 ? 'mañana' : DAY_LONG[next.dayIndex]} ${next.open})`
      : `Cerrado por ${today.label}`;
  }

  return { ...base, isOpen: false, text };
}

export { DAY_ORDER, DAY_SHORT, DAY_LONG };
