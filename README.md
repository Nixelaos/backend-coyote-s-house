# Backend y Panel de Coyote's House

Backend en **Fastify** que permite al taller editar su **horario de atención** y publicar un
**banner de anuncios** en el sitio, sin tocar código ni hacer despliegues.

```
Panel /admin  ──login Google──►  Fastify  ──►  repositorio  ──►  Neon Postgres  (verdad)
                                    │                        └──►  data/*.json    (espejo que lee el sitio)
                                    │
Visitante  ──GET / y *.html──►  Fastify lee el espejo y lo inyecta en el HTML del sitio
                                (nginx y Cloudflare cachean el resultado; ver despliegue.md)
```

**Regla de oro del diseño:** nunca datos inventados. Cada capa sirve el último dato real o
falla: si el espejo no se puede leer, las páginas responden 503 y nginx sigue entregando la
última copia buena (`proxy_cache_use_stale`) en vez de guardar un horario por defecto.

---

## Puesta en marcha

```bash
npm install
cp .env.example .env      # y completar los valores (ver abajo)
npm run dev
```

- Sitio: <http://localhost:3000/> (sirve `../coyote-s-house` con los datos ya dentro del HTML)
- Panel: <http://localhost:3000/admin/>
- API pública: <http://localhost:3000/api/public/site-config>

Sin credenciales de Google el servidor igual arranca: el panel queda deshabilitado con un
aviso claro, pero la API pública funciona. Sirve para probar el sitio antes de tener las
credenciales listas.

En el primer arranque se crean solos `data/schedule.json` y `data/banner.json` con el
horario que el sitio ya tenía (Lun a Vie de 09:00 a 17:00), así que nada cambia el día uno.

---

## Configurar Google OAuth

No se guardan contraseñas: Google es el único proveedor de identidad. Pasos, una sola vez:

1. Entra a <https://console.cloud.google.com/> y crea un proyecto (ej: `coyotes-house`).
2. **APIs y servicios → Pantalla de consentimiento de OAuth**
   - Tipo de usuario: **Externo**.
   - Nombre de la app: `Panel Coyote's House`. Correo de soporte: el tuyo.
   - En *Usuarios de prueba* agrega los correos que van a entrar al panel.
   - No hace falta publicar la app ni pasar verificación: con los usuarios de prueba basta.
3. **APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth**
   - Tipo: **Aplicación web**.
   - *Orígenes autorizados de JavaScript*: `http://localhost:3000`
   - *URI de redirección autorizados*:
     - `http://localhost:3000/auth/google/callback`
     - y, al desplegar, `https://TU-DOMINIO/auth/google/callback`
4. Copia el **ID de cliente** y el **secreto** al archivo `.env`.

> El URI de redirección debe coincidir **carácter por carácter** con `PUBLIC_BASE_URL` +
> `/auth/google/callback`. Es la causa número uno de `redirect_uri_mismatch`.

### Quién puede entrar

Tener cuenta de Google **no** basta. Solo entran los correos listados en
`ADMIN_ALLOWED_EMAILS`; cualquier otro recibe un 403 con explicación. La lista se
comprueba en **cada petición**, no solo al iniciar sesión: si quitas un correo, el acceso
se corta de inmediato sin esperar a que expire la sesión.

---

## Variables de entorno

| Variable | Obligatoria | Para qué |
|---|---|---|
| `PORT` / `HOST` | no | Puerto y dirección de escucha (3000 / 0.0.0.0). |
| `NODE_ENV` | no | `production` activa HSTS y cookies `Secure`. |
| `PUBLIC_BASE_URL` | sí | URL pública del backend. Debe calzar con Google. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | sí (en producción) | Credenciales OAuth. |
| `SESSION_SECRET` | sí | Firma del JWT de sesión. Mínimo 32 caracteres. |
| `ADMIN_ALLOWED_EMAILS` | sí | Correos autorizados, separados por coma. |
| `ALLOWED_ORIGINS` | no | Reservado para restringir orígenes más adelante. |
| `STORAGE_DRIVER` | no | `json` (archivos en `./data`) o `neon` (Postgres como verdad + espejo JSON en `./data`). |
| `DATABASE_URL` | sí (con `neon`) | Cadena de conexión de Neon. La escribe `neon link`. |
| `DATA_DIR` | no | Carpeta del almacenamiento o del espejo. Por defecto `./data`; en Vercel `/tmp/coyote-data`. |
| `SITE_ROOT` | no | Carpeta del sitio público. Por defecto `../coyote-s-house`; en la VM, el docroot de nginx. Si el default no existe solo se avisa (el sitio no se sirve); si se define y no existe, no arranca. |

Generar un secreto:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## Endpoints

### Sitio público (sin sesión, cacheable)

`GET /` y `GET /<pagina>.html` para las 9 páginas de `coyote-s-house/` (`index`,
`caso-ajuste-motor`, `contacto`, `cotizador`, `faq`, `galeria`, `resenas`, `servicios`,
`sobre-alberto`). Fastify lee el archivo de `SITE_ROOT`, inserta antes de `</head>` un bloque
`<script type="application/json" id="coyote-config">` con el mismo JSON de abajo (sin `status`)
y, en `index.html`, reescribe el `openingHoursSpecification` del JSON-LD con el horario real.
Responde con `Cache-Control: public, max-age=0, s-maxage=3600`.

Si el espejo no se puede leer responde **503** con `no-store`: nunca un horario inventado
delante de una caché. Cualquier otra ruta `.html` es 404 (lista cerrada, sin leer del disco).
En desarrollo también sirve `css/`, `js/`, `assets/` y `fonts/` del sitio; en la VM eso lo
hace nginx.

### Público (sin sesión, CORS abierto, cacheado 60 s)

`GET /api/public/site-config`

```json
{
  "schedule": { "timezone": "America/Santiago", "days": { "1": { "open": "09:00", "close": "17:00", "closed": false } }, "exceptions": [] },
  "banner":   { "enabled": true, "message": "...", "linkUrl": "cotizador.html", "speed": "normal", "startsAt": null, "endsAt": null },
  "status":   { "isOpen": true, "text": "Abierto hoy hasta 17:00", "summary": "Lun a Vie: 09:00 a 17:00 hrs" },
  "updatedAt": "2026-09-09T12:00:00.000Z"
}
```

Es exactamente el JSON que va embebido en las páginas, más `status`; sirve para ver qué está
publicando el backend sin abrir el código fuente de una página. Se entrega el horario completo
y el banner con su ventana de vigencia, no el resultado: el estado abierto/cerrado y la
vigencia del banner son función de la hora actual y el HTML puede llevar una hora en caché,
así que los decide el navegador con su reloj. El correo de quien hizo el último cambio **no**
se expone aquí.

`GET /health` — comprobación de vida para el proveedor de hosting.

### Administración (requiere sesión y correo autorizado)

| Método | Ruta |
|---|---|
| `GET` | `/auth/me` |
| `POST` | `/auth/logout` |
| `GET` / `PUT` | `/api/admin/schedule` |
| `GET` / `PUT` | `/api/admin/banner` |

La autenticación corre en el hook `onRequest`, **antes** de validar el cuerpo de la
petición: una llamada anónima recibe un 401 limpio y no un 400 que le revele la forma del
esquema.

---

## Pruebas

```bash
npm test
```

Las pruebas viven en el proyecto hermano `tests-backend-coyote-s-house/`, fuera de este
repositorio: la suite de paridad compara este backend contra el sitio público, así que no
pertenece del todo a ninguno de los dos. `npm test` desde aquí las invoca igual.

Tres suites, sin dependencias de desarrollo:

- **`mirror.test.mjs`** — el espejo JSON delante de Neon, con un primario en memoria (sin
  red): reconstrucción, guardado en dos capas y los dos modos de fallo.
- **`api.test.mjs`** — control de acceso, validaciones, guardado y el render del sitio público
  (bloque inyectado, JSON-LD, 404 fuera de la lista, 503 con el espejo ilegible), usando
  `fastify.inject` (sin abrir puertos). Restaura los datos al terminar.
- **`paridad.test.mjs`** — compara `src/lib/schedule-status.js` (servidor) contra
  `coyote-s-house/js/lib/site-config.js` (navegador) barriendo una semana completa en pasos
  de 90 minutos sobre 10 horarios distintos: **1.280 comparaciones**.

  Esa segunda suite existe por una razón concreta: el sitio público no puede importar código
  de este backend, así que la lógica de "abierto/cerrado" está escrita dos veces. Si las dos
  versiones divergen, el sitio afirma una cosa y la API otra, y nadie se entera hasta que un
  cliente llega al taller cerrado. Si tocas una, corre esta prueba.

Se omite sola si el sitio público no está en `../coyote-s-house`.

---

## Estructura

```
src/
├── server.js              Arranque, manejo de errores, archivos del panel
├── config.js              Lee y valida el entorno; falla temprano y con motivo
├── plugins/
│   ├── auth.js            Google OAuth, sesión JWT y guardia requireAdmin
│   └── security.js        Helmet (CSP), límite de peticiones
├── routes/                public / auth / admin / site (las páginas del sitio con los datos dentro)
├── repositories/          Interfaz { get, save }: json-store.js, neon-store.js y mirror-store.js
├── schemas/               JSON Schema + reglas de negocio en español
└── lib/
    ├── schedule-status.js Cálculo de abierto/cerrado en America/Santiago
    ├── public-config.js   El JSON público (horario + banner), compartido por la API y el HTML
    ├── site-render.js     Inyección del bloque de datos y del JSON-LD en el HTML (puro, sin Fastify)
    └── site-pages.js      Lista cerrada de las 9 páginas y de las carpetas de estáticos
public/admin/              Panel: HTML, CSS y JS sin build ni dependencias
data/                      schedule.json y banner.json (fuera de git); con neon, espejo de la base
migrations/                001_init.sql y los scripts db:migrate / db:seed
```

---

## Almacenamiento: JSON o Neon (+ espejo)

Nada fuera de `src/repositories/` sabe dónde viven los datos. `schedule.repo.js` y
`banner.repo.js` exponen solo `get()`, `save(datos, usuario)` y `hydrate()`, y eligen el
store según `STORAGE_DRIVER`. Rutas, esquemas de validación y panel son idénticos con uno u
otro.

| | `json` | `neon` |
|---|---|---|
| Fuente de verdad | `data/*.json` | Postgres en Neon |
| Qué lee el sitio | `data/*.json` | **`data/*.json`**, un espejo que se reescribe en cada guardado |
| Atomicidad | escritura a archivo temporal + `rename` | una transacción en Neon y después el `rename` del espejo |
| Sobrevive a perder la máquina | no | sí (Neon; el espejo se reconstruye solo al arrancar) |
| Para qué | desarrollo local | producción |

**Por qué el espejo.** Con `neon`, la lectura pública no toca la red: sale del disco local en
menos de un milisegundo y sigue funcionando aunque Neon esté suspendida, lenta o caída. Neon
queda solo en el camino de escritura (el panel) y como la copia que sobrevive a la VM. Al
arrancar, si el espejo no existe o está corrupto, se reconstruye desde Neon una vez
(`hydrate()`); si el espejo no se puede escribir después de un guardado, el guardado **falla
con un mensaje claro** en vez de dejar el sitio mostrando datos viejos en silencio. La lógica
vive en `mirror-store.js` y está probada sin red en `mirror.test.mjs`.

Tablas: `schedule_days`, `schedule_exceptions`, `banners` (fila única) y `audit_log`
—quién cambió qué y cuándo, que en JSON no valía la pena y en Postgres sale gratis.

Las horas se guardan como texto `'HH:MM'` a propósito: es el formato que ya validan los
esquemas y que consumen el panel y el sitio. Con el tipo `time` habría que reformatear
`'09:00:00'` en cada lectura sin ganar nada.

### Poner en marcha la base

```bash
npm run db:migrate   # crea las tablas (idempotente)
npm run db:seed      # vuelca data/*.json a Postgres (idempotente)
```

Ambos leen `DATABASE_URL` del `.env` y aceptan que se la pases por entorno para apuntar a
otra rama. Después, en el `.env`:

```
STORAGE_DRIVER=neon
```

### Trabajar sobre una rama, no sobre production

```bash
neon branch create --name dev
neon connection-string dev
```

Con `STORAGE_DRIVER=neon` y el `DATABASE_URL` del `.env`, **`npm test` escribe en la base
que ahí esté configurada**. La suite guarda horarios y banners de mentira, así que contra
`production` dejaría el sitio con un "Promo futura" y el viernes a las 15:00. Para correrla
sin riesgo:

```bash
DATABASE_URL=<cadena-de-dev> STORAGE_DRIVER=neon npm test
```

---

## Desplegar

Netlify **no** puede alojar este backend: necesita un servidor que quede corriendo. Render,
Railway y Fly.io tienen plan gratuito y sirven.

Al desplegar hay que hacer tres cosas:

1. Cargar las variables de entorno del proveedor, con `PUBLIC_BASE_URL` y `NODE_ENV=production`.
2. Agregar `https://TU-DOMINIO/auth/google/callback` a las credenciales de Google.
3. En el sitio público, apuntar `API_BASE` en
   [`coyote-s-house/js/lib/site-config.js`](../coyote-s-house/js/lib/site-config.js) a la URL
   real del backend.

> **Ojo con el disco.** En los planes gratuitos el sistema de archivos es efímero: se borra
> en cada despliegue y con él los `data/*.json`. Por eso en producción `STORAGE_DRIVER` tiene
> que ser `neon`. Con `json`, un despliegue devolvería el horario a los valores por defecto
> sin avisarle a nadie.
