/**
 * Aplica los archivos .sql de esta carpeta, en orden alfabético.
 *
 *   npm run db:migrate                  # usa DATABASE_URL del .env
 *   DATABASE_URL=... npm run db:migrate # apunta a otra rama de Neon
 *
 * No hay tabla de migraciones aplicadas a propósito: son cuatro tablas y todo
 * el DDL va con "if not exists", así que correr esto de nuevo es inofensivo.
 * Cuando el esquema crezca lo suficiente como para necesitar control de
 * versiones, conviene cambiar a una herramienta dedicada en vez de inflar esto.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { neon } from '@neondatabase/serverless';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.join(AQUI, '..', '.env') });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Falta DATABASE_URL. Revisa el .env o pásala por entorno.');
  process.exit(1);
}

/**
 * Parte un archivo en enunciados sueltos. El driver HTTP de Neon rechaza varios
 * comandos en una sola llamada, así que hay que mandarlos de a uno.
 * Se quitan primero los comentarios de línea para no cortar por un ";" escrito
 * dentro de una explicación.
 */
function separarEnunciados(sql) {
  return sql
    .split('\n')
    .map((linea) => linea.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map((enunciado) => enunciado.trim())
    .filter(Boolean);
}

const sql = neon(url);
const archivos = (await fs.readdir(AQUI)).filter((nombre) => nombre.endsWith('.sql')).sort();

if (archivos.length === 0) {
  console.log('No hay archivos .sql que aplicar.');
  process.exit(0);
}

const { host } = new URL(url);
console.log(`Aplicando ${archivos.length} archivo(s) sobre ${host}\n`);

for (const archivo of archivos) {
  const contenido = await fs.readFile(path.join(AQUI, archivo), 'utf8');
  const enunciados = separarEnunciados(contenido);

  for (const enunciado of enunciados) {
    await sql.query(enunciado);
  }

  console.log(`  OK  ${archivo}  (${enunciados.length} enunciados)`);
}

const tablas = await sql`
  select table_name
    from information_schema.tables
   where table_schema = 'public'
   order by table_name
`;

console.log(`\nTablas en public: ${tablas.map((fila) => fila.table_name).join(', ')}`);
