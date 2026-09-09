# Plan — Conectar el backend de Coyote's House a Neon

Documento de traspaso. Los pasos 1 a 7 de la instalación de Neon **ya se ejecutaron**
(2026-09-09). Lo que queda es la migración real del almacenamiento de JSON a Postgres.

---

## 1. Estado actual (ya hecho — no repetir a ciegas)

| Paso | Comando | Resultado |
|---|---|---|
| 1 | `npm i -g neon@latest` + login | CLI **4.14.5**. Sesión de `nnicolaslf@gmail.com` |
| 2 | `neon skills -y` | 7 skills en `.claude/skills` de la raíz (siguen ahí) |
| 3 | `neon mcp -y` | MCP escrito en 6 configs de agentes |
| 4 | `neon link --project-id frosty-block-22445989 --branch production -y` | `.neon` + variables en `.env`, **dentro de `backend-coyote-s-house/`** |
| 5 | `neon config init` | `neon.ts` + `@neon/config`, `@neon/env`, **dentro de `backend-coyote-s-house/`** |
| 6 | Editar `neon.ts` → `auth: true` | Hecho |
| 7 | `neon deploy` | `No changes — branch production already matches the policy.` |

**Coordenadas del proyecto:**

```
org       org-lucky-grass-14735281
project   frosty-block-22445989
branch    production  (br-shiny-mouse-acxls5cn)
región    sa-east-1 (São Paulo)
base      neondb   ·   rol: neondb_owner
```

**Variables en `backend-coyote-s-house/.env` (ignorado por git):**
`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_BRANCH`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_JWKS_URL`

El CLI las agrega al final del `.env` existente sin pisar los secretos de Google ni duplicar claves.

`neon deploy` es idempotente: volver a correrlo es seguro y vuelve a reportar "No changes".

### Pendiente de seguridad — revisar antes de seguir

`neon mcp -y` acuñó una API key **de alcance total sobre la cuenta, en todas las
organizaciones**, y la escribió en seis archivos de configuración de este equipo
(`.claude.json`, `.codex/config.toml`, `.gemini/`, `.copilot/`, `AppData/Roaming/Code/User/mcp.json`).

```
key: neon-cli-mcp-20260909T170248Z-0c6c   (id 3324682)
revocar: neon api-keys revoke 3324682
```

Si el equipo es compartido o no querías esa llave repartida en tantos agentes, revócala y
vuelve a emitir una acotada al proyecto.

> Nota menor: `neon me` reporta `Projects Limit 0`. Conviene confirmar en la consola web que
> el plan permita lo que se necesita antes de depender de esto en producción.

---

## 2. Decisión que hay que tomar primero (bloquea el diseño)

`neon.ts` quedó con `auth: true`, así que el proyecto expone **Neon Auth**
(`NEON_AUTH_BASE_URL`, `NEON_AUTH_JWKS_URL`). Pero el backend **ya tiene su propio login con
Google** funcionando: `@fastify/oauth2` + JWT firmado en cookie httpOnly + allowlist de
correos ([`src/plugins/auth.js`](backend-coyote-s-house/src/plugins/auth.js)).

Son dos sistemas de autenticación que hacen lo mismo. Hay que elegir:

**Opción A — Dejar el login actual, usar Neon solo como base de datos (recomendada).**
No se toca nada de autenticación. Neon aporta únicamente persistencia. Es el camino más corto
y no arriesga el acceso de Alberto al panel, que ya está probado.
→ Considerar poner `auth: false` en `neon.ts` para no dejar un servicio encendido sin usar.

**Opción B — Migrar a Neon Auth.**
Se reemplaza la emisión del JWT propio por validación de tokens contra el JWKS de Neon. Da
gestión de usuarios sin código propio, pero obliga a rehacer `requireAdmin`, el callback de
Google y el flujo del panel, y a repensar la allowlist de correos.

**Todo lo que sigue en este documento asume la Opción A.** Si se elige B, hay que planificar
esa parte aparte.

---

## 3. Por qué esta migración importa

No es una mejora opcional. Hoy los datos viven en `backend-coyote-s-house/data/*.json`, y en
los planes gratuitos de Render/Railway/Fly **el disco es efímero**: cada despliegue borraría
el horario que Alberto configuró y lo devolvería a los valores por defecto, sin avisar.

Migrar a Neon es lo que habilita el despliegue a producción.

---

## 4. Trabajo restante

### Paso 4.1 — Verificar que la conexión funciona

Esto quedó pendiente cuando se interrumpió la sesión anterior. **No está verificado.**

```bash
cd backend-coyote-s-house
neon connection-string production          # confirma la cadena
```

Prueba real de conectividad (crea el archivo, córrelo, bórralo):

```js
// verificar-neon.mjs
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
console.log(await sql`select version(), current_database(), now()`);
```

Si falla por red o SSL, revisar `sslmode=require` y si hay IP Allow activo en el proyecto.

### Paso 4.2 — Dejar `DATABASE_URL` al alcance del backend  ✅ HECHO (2026-09-09)

Estaba el workspace de Neon en la raíz `coyoteshouse/`, que no es un repo, mientras que el
único que habla con Postgres es el backend. Se mudó entero:

```bash
cd backend-coyote-s-house
neon link --project-id frosty-block-22445989 --branch production -y
neon config init
```

Quedó así:

- `backend-coyote-s-house/.neon`, `neon.ts` y las dependencias `@neon/config` / `@neon/env`.
- Las 5 variables de Neon **anexadas a `backend-coyote-s-house/.env`** (no a un `.env.local`).
  Como [`src/config.js`](backend-coyote-s-house/src/config.js) ya llama a `dotenv.config()`,
  que lee ese archivo, **no hizo falta tocar `config.js`** ni encadenar un segundo `loadDotenv`.
- `.neon` agregado al [`.gitignore` del backend](backend-coyote-s-house/.gitignore); `.env` ya estaba.
- Eliminados de la raíz: `.neon`, `.env.local`, `neon.ts`, `package.json`, `package-lock.json`
  y `node_modules/`, más un `.gitignore` que no hacía nada porque la raíz no es un repo.
- Se conservan en la raíz `.claude/` y `skills-lock.json`, que sí corresponden al workspace del
  agente, y `plan.md`.

Verificado tras la mudanza: `neon config plan` → *No changes — branch production already matches
the policy*; `npm test` → 23 pruebas OK y 1280 comparaciones sin divergencias.

> El `neon config init` del backend generó un `neon.ts` de plantilla (`auth: false` más una
> política de branches con TTL de 7 días). Se restauró el contenido original (`auth: true`, sin
> política de branches) para no alterar la infraestructura. Si alguna vez se adopta esa plantilla,
> revisar el TTL antes de correr `neon deploy`.

### Paso 4.3 — Crear el esquema

```bash
npm i @neondatabase/serverless
```

> Se elige `@neondatabase/serverless` porque su `Pool` es compatible con la API de `pg` y
> sirve tanto en servidor persistente como serverless. `pg` a secas también funciona.

Migración SQL (guardar como `backend-coyote-s-house/migrations/001_init.sql`):

```sql
-- Las horas se guardan como texto 'HH:MM' a propósito: es el formato exacto que ya
-- validan los esquemas y que consumen el panel y el sitio. Usar el tipo `time`
-- obligaría a reformatear '09:00:00' -> '09:00' en cada lectura, sin ganar nada.
create table if not exists schedule_days (
  day_index  smallint primary key check (day_index between 0 and 6),
  open_time  text not null check (open_time  ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  close_time text not null check (close_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  closed     boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists schedule_exceptions (
  exception_date date primary key,
  closed     boolean not null default true,
  open_time  text check (open_time  ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  close_time text check (close_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  label      text not null default '',
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Fila única: el sitio tiene un solo banner.
create table if not exists banners (
  id         smallint primary key default 1 check (id = 1),
  enabled    boolean not null default false,
  message    text not null default '',
  link_url   text not null default '',
  speed      text not null default 'normal' check (speed in ('slow','normal','fast')),
  starts_at  timestamptz,
  ends_at    timestamptz,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- En JSON no valía la pena; en Postgres sale gratis y responde
-- "quién cambió el horario y cuándo".
create table if not exists audit_log (
  id         bigserial primary key,
  entity     text not null check (entity in ('schedule', 'banner')),
  payload    jsonb not null,
  changed_by text not null,
  changed_at timestamptz not null default now()
);

create index if not exists audit_log_entity_fecha_idx
  on audit_log (entity, changed_at desc);
```

La zona horaria (`America/Santiago`) **no** va en la base: ya es una constante en
`config.timezone` y no es algo que el taller edite.

### Paso 4.4 — Escribir el adaptador

Crear `backend-coyote-s-house/src/repositories/neon-store.js` cumpliendo **exactamente** el
mismo contrato que ya usan las rutas:

```
get()                -> Promise<Schedule | Banner>
save(datos, usuario) -> Promise<Schedule | Banner>   (sella updatedAt / updatedBy)
```

Puntos a respetar para que nada más cambie:

- `get()` del horario debe devolver **siempre los 7 días**, igual que `normalizeSchedule()`
  en [`schedule.repo.js`](backend-coyote-s-house/src/repositories/schedule.repo.js). Si la
  tabla está vacía, sembrar con `DEFAULT_SCHEDULE` de
  [`src/lib/defaults.js`](backend-coyote-s-house/src/lib/defaults.js).
- Las excepciones se devuelven **ordenadas por fecha ascendente**.
- `save()` del horario reemplaza los 7 días y **todas** las excepciones dentro de una
  **transacción**: hoy el archivo JSON se escribe de forma atómica y esa garantía no se
  puede perder, o un fallo a medio guardar dejaría un horario incoherente en el sitio.
- Escribir también en `audit_log` dentro de la misma transacción.

Luego, en `src/config.js` / donde corresponda, seleccionar el driver según
`STORAGE_DRIVER` (`json` | `neon`), que ya existe como variable.

### Paso 4.5 — Migrar los datos actuales

Script `backend-coyote-s-house/migrations/migrar-json-a-neon.mjs` que lea
`data/schedule.json` y `data/banner.json` y los inserte. Debe ser **idempotente**
(`on conflict do update`), para poder correrlo dos veces sin duplicar.

Si los JSON no existen todavía, sembrar directamente desde `DEFAULT_SCHEDULE` /
`DEFAULT_BANNER`.

### Paso 4.6 — Cambiar el driver

En `backend-coyote-s-house/.env`:

```
STORAGE_DRIVER=neon
```

**Rutas, esquemas de validación y el panel no se tocan.** Ese es justamente el punto de la
capa de repositorio: si hubo que modificar algo fuera de `src/repositories/`, es señal de que
el adaptador no está respetando el contrato.

---

## 5. Verificación

```bash
cd backend-coyote-s-house
npm test
```

Las dos suites deben seguir en verde **sin modificarlas**:

- `test/api.test.mjs` — 23 pruebas: control de acceso, validaciones, guardado.
- `test/paridad.test.mjs` — 1.280 comparaciones entre la lógica del servidor y la del
  navegador.

> Ojo: `api.test.mjs` hoy respalda y restaura `data/*.json`. Con `STORAGE_DRIVER=neon`
> escribiría contra la base **de producción**. Antes de correrlo así, apuntarlo a una rama
> de desarrollo de Neon:
> ```bash
> neon branch create test-ci
> ```
> y usar esa `DATABASE_URL` en el test. Es la razón principal por la que conviene hacer todo
> este trabajo sobre una rama y no sobre `production`.

Pruebas manuales de punta a punta:

1. Cambiar el horario en `/admin`, guardar → `select * from schedule_days;` refleja el cambio
   con `updated_by`.
2. Recargar el sitio → topbar, pie, contacto y FAQ muestran el horario nuevo.
3. Reiniciar el backend → el horario **persiste** (esto es lo que hoy no se cumple).
4. Apagar el backend → el sitio sigue en pie con el horario de respaldo, sin banner y con el
   layout intacto.

---

## 6. Lo que queda fuera de Neon (sigue pendiente de antes)

Son independientes de esta migración, pero bloquean el uso real del panel:

1. **Credenciales de Google.** `backend-coyote-s-house/.env` tiene `SESSION_SECRET` generado,
   pero faltan `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y el correo de Alberto en
   `ADMIN_ALLOWED_EMAILS`. Pasos exactos de Google Cloud Console en el
   [README del backend](backend-coyote-s-house/README.md#configurar-google-oauth).
2. **`API_BASE` del sitio público.** En
   [`coyote-s-house/js/lib/site-config.js:34`](coyote-s-house/js/lib/site-config.js#L34) hay
   una URL de marcador de posición; apuntarla al backend real al desplegar.
3. **Hosting del backend.** Netlify no puede alojarlo (necesita un proceso persistente).
   Render / Railway / Fly. Al desplegar hay que agregar
   `https://TU-DOMINIO/auth/google/callback` a las credenciales de Google.
4. **Revisión visual en navegador real.** La animación del marquee y el comportamiento en
   móvil se verificaron a nivel de DOM (jsdom), no de píxeles. Falta mirarlo en un navegador.

---

## 7. Orden sugerido

```
Decidir Opción A vs B  (sección 2)
        ↓
4.1 verificar conexión ──► 4.2 wiring de DATABASE_URL
        ↓
crear rama de Neon para desarrollo  (neon branch create dev)
        ↓
4.3 esquema ──► 4.4 adaptador ──► 4.5 migrar datos ──► 4.6 cambiar driver
        ↓
npm test + pruebas manuales
        ↓
aplicar el esquema a production y desplegar
```

Trabajar sobre una rama de Neon y recién al final tocar `production`.
