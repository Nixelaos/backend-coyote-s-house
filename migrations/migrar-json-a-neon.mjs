/**
 * Vuelca data/schedule.json y data/banner.json a Postgres.
 *
 *   npm run db:seed                  # usa DATABASE_URL del .env
 *   DATABASE_URL=... npm run db:seed # apunta a otra rama de Neon
 *
 * Es idempotente: todo va con "on conflict do update", así que correrlo dos
 * veces deja la base igual que correrlo una. Si los JSON todavía no existen
 * —una instalación limpia— se siembra desde DEFAULT_SCHEDULE / DEFAULT_BANNER,
 * que es exactamente el horario que el sitio ya muestra escrito a mano.
 *
 * Se reutilizan normalizeSchedule y normalizeBanner en vez de leer el JSON en
 * crudo: así un archivo viejo o editado a mano entra a la base con la misma
 * forma que exige el resto del backend.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..');
loadDotenv({ path: path.join(RAIZ, '.env') });

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL. Revisa el .env o pásala por entorno.');
  process.exit(1);
}

// El store de Neon lee config.databaseUrl, y config.js congela el valor al
// importarse. Se fuerza el driver antes de ese import para que el script
// escriba en Postgres aunque el .env siga en STORAGE_DRIVER=json.
process.env.STORAGE_DRIVER = 'neon';

const { DEFAULT_SCHEDULE, DEFAULT_BANNER } = await import('../src/lib/defaults.js');
const { normalizeSchedule } = await import('../src/repositories/schedule.repo.js');
const { normalizeBanner } = await import('../src/repositories/banner.repo.js');
const { createNeonScheduleStore, createNeonBannerStore } = await import(
  '../src/repositories/neon-store.js'
);

/** Lee un JSON de data/; devuelve los valores por defecto si no existe. */
async function leerJson(nombre, porDefecto) {
  try {
    const crudo = await fs.readFile(path.join(RAIZ, 'data', nombre), 'utf8');
    return { datos: JSON.parse(crudo), origen: `data/${nombre}` };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { datos: structuredClone(porDefecto), origen: 'valores por defecto' };
    }
    throw error;
  }
}

const { host } = new URL(process.env.DATABASE_URL);
console.log(`Migrando hacia ${host}\n`);

const horario = await leerJson('schedule.json', DEFAULT_SCHEDULE);
const banner = await leerJson('banner.json', DEFAULT_BANNER);

const storeHorario = createNeonScheduleStore({ normalize: normalizeSchedule });
const storeBanner = createNeonBannerStore({ normalize: normalizeBanner });

// updatedBy se conserva tal cual venía. Si el JSON nunca se editó viene en null
// y el store lo traduce a "desconocido" en la columna, que es más honesto que
// atribuirle el cambio a quien corre el script.
const horarioGuardado = await storeHorario.save(normalizeSchedule(horario.datos));
console.log(`  horario  <- ${horario.origen}`);
console.log(`             7 días, ${horarioGuardado.exceptions.length} excepción(es)`);

const bannerGuardado = await storeBanner.save(normalizeBanner(banner.datos));
console.log(`  banner   <- ${banner.origen}`);
console.log(`             ${bannerGuardado.enabled ? 'activo' : 'apagado'}, velocidad ${bannerGuardado.speed}`);

console.log('\nListo. Volver a correrlo no duplica nada.');
