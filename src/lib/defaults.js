/**
 * Valores iniciales del sistema.
 *
 * El horario por defecto replica EXACTAMENTE el que hoy está escrito a mano en
 * el sitio (Lun a Vie de 09:00 a 17:00), para que al encender el backend por
 * primera vez nada cambie de cara al visitante.
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
