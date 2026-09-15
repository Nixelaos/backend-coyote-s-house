/**
 * Valores iniciales del panel.
 *
 * Solo son el punto de partida del formulario cuando todavía no hay nada
 * guardado (o el archivo está dañado). Nunca se publican: el sitio muestra
 * únicamente lo que alguien guardó desde el panel.
 */

export const DEFAULT_SCHEDULE = {
  timezone: 'America/Santiago',
  days: {
    0: { open: '09:00', close: '13:00', closed: true },  // Domingo
    1: { open: '09:00', close: '17:00', closed: false }, // Lunes
    2: { open: '09:00', close: '17:00', closed: false }, // Martes
    3: { open: '09:00', close: '17:00', closed: false }, // Miércoles
    4: { open: '09:00', close: '17:00', closed: false }, // Jueves
    5: { open: '09:00', close: '17:00', closed: false }, // Viernes
    6: { open: '09:00', close: '13:00', closed: true }   // Sábado
  },
  exceptions: [],
  updatedAt: null,
  updatedBy: null
};

export const DEFAULT_BANNER = {
  enabled: false,
  message: '',
  linkUrl: '',
  speed: 'normal',
  startsAt: null,
  endsAt: null,
  updatedAt: null,
  updatedBy: null
};
