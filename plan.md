# Plan — Conectar el backend de Coyote's House a Neon

Documento de traspaso. La instalación de Neon y **la migración completa de JSON a Postgres
ya están hechas y verificadas** (2026-09-09), sobre la rama `dev`. Lo único que queda es
aplicar el esquema a `production` y desplegar — ver la sección 4.7.

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

## 2. La decisión de fondo (ya tomada: Opción A)

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

**Se tomó la Opción A.** Neon quedó como base de datos y nada más; `src/plugins/auth.js` no
se tocó. `neon.ts` sigue con `auth: true`: cambiarlo a `false` apagaría un servicio que no se
está usando, pero es una decisión de infraestructura aparte y no bloquea nada.

---

## 3. Por qué esta migración importa

No es una mejora opcional. Hoy los datos viven en `backend-coyote-s-house/data/*.json`, y en
los planes gratuitos de Render/Railway/Fly **el disco es efímero**: cada despliegue borraría
el horario que Alberto configuró y lo devolvería a los valores por defecto, sin avisar.

Migrar a Neon es lo que habilita el despliegue a producción.

---

## 4. La migración, paso por paso

### Paso 4.1 — Verificar que la conexión funciona  ✅ HECHO (2026-09-09)

Respondió `PostgreSQL 18.6`, base `neondb`, rama `production`. El script de prueba se borró
después de correrlo, como estaba previsto.

```bash
cd backend-coyote-s-house
neon connection-string production          # confirma la cadena
```

Lo que se ejecutó (archivo temporal, borrado después):

```js
// verificar-neon.mjs
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
console.log(await sql`select version(), current_database(), now()`);
```

No hizo falta tocar `sslmode` ni IP Allow: la cadena que escribe `neon link` ya trae
`sslmode=require` y el proyecto no tiene lista de IP activa.

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

### Paso 4.3 — Crear el esquema  ✅ HECHO (2026-09-09)

`npm i @neondatabase/serverless`. El esquema quedó en
[`migrations/001_init.sql`](backend-coyote-s-house/migrations/001_init.sql), tal como estaba
diseñado en este plan: `schedule_days`, `schedule_exceptions`, `banners` (fila única) y
`audit_log`, con su índice. La zona horaria no entró a la base: sigue siendo la constante
`config.timezone`.

Para aplicarlo hizo falta algo que el plan no contemplaba: el driver HTTP de Neon rechaza
varios comandos en una misma llamada (*cannot insert multiple commands into a prepared
statement*), así que un `.sql` con cinco enunciados no se puede mandar de una. Se agregó
[`migrations/aplicar-esquema.mjs`](backend-coyote-s-house/migrations/aplicar-esquema.mjs),
que separa el archivo por `;` —descartando antes los comentarios, para no cortar por un `;`
escrito dentro de una explicación— y los manda de a uno.

```bash
npm run db:migrate                          # usa DATABASE_URL del .env
DATABASE_URL=<otra-rama> npm run db:migrate  # apunta a otra rama
```

No hay tabla de migraciones aplicadas: son cuatro tablas y todo el DDL va con
`if not exists`, así que repetirlo es inofensivo. Cuando el esquema crezca lo suficiente
como para necesitar versionado, conviene cambiar a una herramienta dedicada antes que
inflar ese script.

### Paso 4.4 — Escribir el adaptador  ✅ HECHO (2026-09-09)

[`src/repositories/neon-store.js`](backend-coyote-s-house/src/repositories/neon-store.js),
con la misma pareja `{ get, save }` que `json-store.js`. El driver se elige en una sola
línea de cada repositorio, según `config.storageDriver`. **No se tocó nada fuera de
`src/repositories/`**: ni rutas, ni esquemas de validación, ni el panel.

Tres decisiones que el plan dejaba abiertas:

- **Driver HTTP (`neon`), no `Pool` por WebSocket.** `sql.transaction([...])` da la
  atomicidad que se exigía —los enunciados de cada guardado se conocen de antemano— sin
  arrastrar la dependencia `ws`, que haría falta en Node 20 porque todavía no trae
  `WebSocket` global y el `package.json` declara `node >=20.11.0`.
- **Las fechas se leen con `to_char(exception_date, 'YYYY-MM-DD')`.** Devolver la columna
  `date` en crudo hace que el driver la convierta en un `Date` de la zona local, y una
  excepción del 18 de septiembre puede terminar guardada como el 17. Verificado: `2026-09-18`
  y `2026-12-25` vuelven idénticas.
- **`updatedAt` es `null` mientras `updated_by` lo sea.** Las filas recién sembradas traen
  `updated_at = now()` por el DEFAULT de la tabla, pero nadie las editó; el store de JSON en
  ese caso devuelve `null`. Sin esta regla los dos drivers no darían la misma respuesta.

Los `timestamptz` se devuelven como string ISO, igual que el driver JSON, para que la forma
de la API pública no cambie según el motor de almacenamiento.

### Paso 4.5 — Migrar los datos actuales  ✅ HECHO (2026-09-09)

[`migrations/migrar-json-a-neon.mjs`](backend-coyote-s-house/migrations/migrar-json-a-neon.mjs),
expuesto como `npm run db:seed`. Reutiliza `normalizeSchedule` y `normalizeBanner` en vez de
leer el JSON en crudo, para que un archivo viejo o editado a mano entre con la forma que
exige el resto del backend. Si los JSON no existen, siembra desde `DEFAULT_SCHEDULE` /
`DEFAULT_BANNER`.

Idempotencia comprobada corriéndolo dos veces seguidas: `schedule_days` sigue con 7 filas y
`banners` con una. `audit_log` sí acumula una entrada por corrida, que es justamente su
oficio.

`updatedBy` se conserva tal cual venía en el JSON. Como nunca se había editado, las filas
quedan con `'desconocido'` en vez de atribuirle el cambio a quien corre el script.

### Paso 4.6 — Cambiar el driver  ⏸ PENDIENTE, a propósito

El `.env` local **sigue en `STORAGE_DRIVER=json`**. El motivo: su `DATABASE_URL` apunta a
`production`, y `production` todavía no tiene las tablas. Ver 4.7.

---

### Paso 4.7 — Lo único que queda

Todo lo anterior está hecho y verificado **sobre la rama `dev`** (`br-raspy-leaf-acxjfpas`,
creada con `neon branch create --name dev`). `production` sigue sin una sola tabla, intacta.

Para terminar:

```bash
cd backend-coyote-s-house
npm run db:migrate     # crea las 4 tablas en production
npm run db:seed        # vuelca data/*.json
```

y después poner en el `.env` (o en las variables del hosting):

```
STORAGE_DRIVER=neon
```

Ninguno de los dos comandos destruye nada: `production` está vacía y ambos son idempotentes.

---

## 5. Verificación  ✅ HECHA

Las dos suites pasan **sin modificar una sola aserción**, con los dos drivers:

| | `npm test` (json) | `STORAGE_DRIVER=neon` + rama `dev` |
|---|---|---|
| `test/api.test.mjs` | 23 / 23 | 23 / 23 |
| `test/paridad.test.mjs` | 1.280, 0 divergencias | 1.280, 0 divergencias |

Comprobado además contra la base, en un proceso aparte del que escribió: los 7 días con
`updated_by = 'alberto@gmail.com'`, la excepción `2026-09-18` con su etiqueta, el banner
programado a 2099 y 10 entradas en `audit_log`.

**Persistencia tras reiniciar** —el punto de toda la migración— probada explícitamente: un
proceso guarda el miércoles 08:15-16:45 y una excepción de Navidad; un proceso nuevo, sin
nada en memoria, lo lee idéntico desde Postgres.

### La guarda contra escribir en producción

El plan advertía que `api.test.mjs` con `STORAGE_DRIVER=neon` escribiría en la base real. Se
resolvió con una guarda al inicio del archivo: compara el `DATABASE_URL` en uso contra el
declarado en el `.env` —que es el de `production`— ignorando el sufijo `-pooler`, y si son
el mismo endpoint aborta explicando cómo apuntar a `dev`. Es lo único que se agregó a las
pruebas; ninguna aserción cambió.

Las tres rutas verificadas: con `json` corre normal; con `neon` + `production` aborta; con
`neon` + `dev` corre y pasa.

La cadena de `dev` quedó en el `.env` como `DATABASE_URL_TEST` (no se lee sola):

```bash
DATABASE_URL=$DATABASE_URL_TEST STORAGE_DRIVER=neon npm test
```

### Pruebas manuales que siguen pendientes

Necesitan un navegador y las credenciales de Google, así que no se pudieron cerrar aquí:

1. Cambiar el horario en `/admin` y verlo reflejado en el sitio.
2. Apagar el backend y confirmar que el sitio sigue en pie con el horario de respaldo.

---

## 6. Lo que queda fuera de Neon (sigue pendiente de antes)

Son independientes de esta migración, pero bloquean el uso real del panel:

1. **Credenciales de Google.** El `.env` ya tiene `SESSION_SECRET`, `GOOGLE_CLIENT_ID` y
   `GOOGLE_CLIENT_SECRET`. Lo que falta es agregar **el correo de Alberto** a
   `ADMIN_ALLOWED_EMAILS`, que hoy solo lista el de quien configuró esto. Sin eso, Alberto
   recibe un 403 al entrar al panel. Pasos de Google Cloud Console en el
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

## 7. Dónde quedó todo

```
Opción A elegida  ·  login de Google intacto
        ↓
4.1 conexión ✅ ──► 4.2 wiring ✅ ──► rama dev creada ✅
        ↓
4.3 esquema ✅ ──► 4.4 adaptador ✅ ──► 4.5 datos ✅
        ↓
npm test con los dos drivers ✅  ·  persistencia tras reinicio ✅
        ↓
4.7 aplicar a production  ⏸  ← lo único que falta
        ↓
desplegar (sección 6)
```

**Archivos nuevos:** `migrations/001_init.sql`, `migrations/aplicar-esquema.mjs`,
`migrations/migrar-json-a-neon.mjs`, `src/repositories/neon-store.js`.

**Archivos tocados:** `schedule.repo.js` y `banner.repo.js` (una línea cada uno: elegir el
store), `package.json` (dependencia + `db:migrate` / `db:seed`), `test/api.test.mjs` (solo la
guarda), `README.md`, `.env.example`.

**Sin tocar:** rutas, esquemas de validación, panel, `src/plugins/auth.js`, `src/config.js`.
Era la señal de que el adaptador respeta el contrato, y se cumplió.

Nada está confirmado en git todavía: los cambios están en el árbol de trabajo.
