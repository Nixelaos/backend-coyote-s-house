/**
 * Pruebas de la API sin levantar red: se usa fastify.inject.
 *
 * Ejecutar con:  npm test
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..');

// Credenciales de mentira para activar el camino de autenticación sin tocar
// Google, y una carpeta de datos aparte para no pisar los datos reales.
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.SESSION_SECRET = 'x'.repeat(64);
process.env.ADMIN_ALLOWED_EMAILS = 'alberto@gmail.com';
process.env.NODE_ENV = 'test';

// En Windows import() necesita una URL file://, no una ruta con letra de unidad.
const { buildServer } = await import(pathToFileURL(path.join(RAIZ, 'src', 'server.js')).href);

const app = await buildServer();
await app.ready();

let ok = 0;
let fallos = 0;

function check(nombre, condicion, extra = '') {
  if (condicion) {
    ok += 1;
    console.log(`  OK   ${nombre}`);
  } else {
    fallos += 1;
    console.log(`  FALLA ${nombre} ${extra}`);
  }
}

// Se guarda el estado real para restaurarlo al final.
const RUTA_HORARIO = path.join(RAIZ, 'data', 'schedule.json');
const RUTA_BANNER = path.join(RAIZ, 'data', 'banner.json');
const respaldo = {
  horario: fs.existsSync(RUTA_HORARIO) ? fs.readFileSync(RUTA_HORARIO, 'utf8') : null,
  banner: fs.existsSync(RUTA_BANNER) ? fs.readFileSync(RUTA_BANNER, 'utf8') : null
};

console.log('\n--- Control de acceso ---');

let r = await app.inject({ method: 'PUT', url: '/api/admin/schedule', payload: {} });
check('PUT sin sesión devuelve 401', r.statusCode === 401, `(fue ${r.statusCode})`);
check('el 401 no filtra la forma del esquema', !r.body.includes('days'));

r = await app.inject({ method: 'GET', url: '/api/admin/schedule' });
check('GET sin sesión devuelve 401', r.statusCode === 401, `(fue ${r.statusCode})`);

const intruso = app.jwt.sign({ email: 'random@gmail.com', name: 'Random' });
r = await app.inject({
  method: 'GET',
  url: '/api/admin/schedule',
  cookies: { coyote_admin: intruso }
});
check('correo fuera de la allowlist devuelve 403', r.statusCode === 403, `(fue ${r.statusCode})`);

const token = app.jwt.sign({ email: 'alberto@gmail.com', name: 'Alberto Pizarro' });
const cookies = { coyote_admin: token };

r = await app.inject({ method: 'GET', url: '/api/admin/schedule', cookies });
check('sesión válida devuelve 200', r.statusCode === 200, `(fue ${r.statusCode})`);
check('las respuestas del panel no se cachean', r.headers['cache-control'] === 'no-store');

const base = r.json().schedule;

console.log('\n--- Validación del horario ---');

r = await app.inject({
  method: 'PUT',
  url: '/api/admin/schedule',
  cookies,
  payload: { days: { ...base.days, 5: { open: '17:00', close: '09:00', closed: false } }, exceptions: [] }
});
check('cierre anterior a la apertura devuelve 400', r.statusCode === 400, `(fue ${r.statusCode})`);
check('el error se explica en español', /no es posterior/.test(r.body));

r = await app.inject({
  method: 'PUT',
  url: '/api/admin/schedule',
  cookies,
  payload: { days: { ...base.days, 1: { open: '25:99', close: '17:00', closed: false } }, exceptions: [] }
});
check('hora inválida devuelve 400 y no 500', r.statusCode === 400, `(fue ${r.statusCode})`);

r = await app.inject({
  method: 'PUT',
  url: '/api/admin/schedule',
  cookies,
  payload: { days: base.days, exceptions: [{ date: '2026-02-31', closed: true, label: 'Inexistente' }] }
});
check('fecha que no existe en el calendario devuelve 400', r.statusCode === 400, `(fue ${r.statusCode})`);

console.log('\n--- Guardado y publicación ---');

r = await app.inject({
  method: 'PUT',
  url: '/api/admin/schedule',
  cookies,
  payload: {
    days: { ...base.days, 5: { open: '09:00', close: '15:00', closed: false } },
    exceptions: [{ date: '2026-09-18', closed: true, label: 'Fiestas Patrias' }]
  }
});
check('guardar un horario válido devuelve 200', r.statusCode === 200, `(fue ${r.statusCode})`);
check('el viernes queda en 15:00', r.json().schedule.days['5'].close === '15:00');
check('se sella updatedBy con el correo', r.json().schedule.updatedBy === 'alberto@gmail.com');
check(
  'el resumen agrupa los días con el mismo tramo',
  r.json().status.summary === 'Lun a Jue: 09:00 a 17:00 hrs · Vie: 09:00 a 15:00 hrs',
  `(${r.json().status.summary})`
);

r = await app.inject({ method: 'GET', url: '/api/public/site-config' });
check('la API pública refleja el cambio', r.json().schedule.days['5'].close === '15:00');
check('la API pública NO expone el correo del administrador', !r.body.includes('alberto@gmail.com'));
check('la API pública es cacheable', /max-age=60/.test(r.headers['cache-control']));

console.log('\n--- Banner ---');

r = await app.inject({
  method: 'PUT',
  url: '/api/admin/banner',
  cookies,
  payload: { enabled: true, message: '' }
});
check('activar el banner sin mensaje devuelve 400', r.statusCode === 400, `(fue ${r.statusCode})`);

r = await app.inject({
  method: 'PUT',
  url: '/api/admin/banner',
  cookies,
  payload: { enabled: true, message: 'Promo', linkUrl: 'javascript:alert(1)' }
});
check('se rechaza un enlace javascript:', r.statusCode === 400, `(fue ${r.statusCode})`);

r = await app.inject({
  method: 'PUT',
  url: '/api/admin/banner',
  cookies,
  payload: { enabled: true, message: 'Promoción de septiembre', linkUrl: 'cotizador.html', speed: 'fast' }
});
check('guardar un banner válido devuelve 200', r.statusCode === 200, `(fue ${r.statusCode})`);

r = await app.inject({ method: 'GET', url: '/api/public/site-config' });
check('el banner aparece publicado', r.json().banner.enabled === true && r.json().banner.speed === 'fast');

r = await app.inject({
  method: 'PUT',
  url: '/api/admin/banner',
  cookies,
  payload: { enabled: true, message: 'Promo futura', startsAt: '2099-01-01T00:00:00.000Z' }
});
check('se puede programar un banner a futuro', r.statusCode === 200, `(fue ${r.statusCode})`);

r = await app.inject({ method: 'GET', url: '/api/public/site-config' });
check('un banner que aún no empieza no se publica', r.json().banner.enabled === false);

await app.close();

// Restaura los datos que había antes de la prueba.
if (respaldo.horario !== null) fs.writeFileSync(RUTA_HORARIO, respaldo.horario, 'utf8');
else fs.rmSync(RUTA_HORARIO, { force: true });
if (respaldo.banner !== null) fs.writeFileSync(RUTA_BANNER, respaldo.banner, 'utf8');
else fs.rmSync(RUTA_BANNER, { force: true });

console.log(`\n${ok} pruebas OK, ${fallos} fallidas\n`);
process.exit(fallos > 0 ? 1 : 0);
