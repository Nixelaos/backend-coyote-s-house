# Backend y Panel de Coyote's House

Backend en **Fastify** que permite al taller editar su **horario de atención** y publicar un
**banner de anuncios** en el sitio, sin tocar código ni hacer despliegues.

```
Panel /admin  ──login Google──►  Fastify  ──►  data/schedule.json, data/banner.json  (la única copia)
                                    ▲
Sitio (HTML estático)  ──GET /api/public/site-config──┘
```

El sitio público (`../coyote-s-house`) no pasa por este backend: es HTML estático que en
producción sirve nginx y cachea Cloudflare. Cada página pide el horario y el banner a la API
al cargar, así que un cambio guardado desde el panel se ve sin esperar a que venza la caché
del HTML.

**Regla de oro:** nunca datos inventados. Si no hay un horario guardado y legible, la API
responde 503 y el sitio no muestra horario ni anuncio.

---

## Puesta en marcha

```bash
npm install
cp .env.example .env      # y completar los valores (ver abajo)
npm run dev
```

- Panel: <http://localhost:3000/admin/>
- API pública: <http://localhost:3000/api/public/site-config>

Para ver el sitio, sírvelo con un servidor estático desde `../coyote-s-house`:

```bash
cd ../coyote-s-house
python -m http.server 5500      # o Live Server de VS Code en el puerto 5500
```

y abre <http://localhost:5500/>. En `localhost` el sitio pide los datos a
`http://localhost:3000` (ver `API_BASE` en `js/lib/site-config.js`). Evita servidores que
reescriben las URLs sin `.html` (como `npx serve` con su configuración por defecto): la
navegación del sitio se guía por el nombre del archivo.

Sin credenciales de Google el servidor igual arranca: el panel queda deshabilitado con un
aviso claro, pero la API pública funciona.

### El primer horario

**No se crean datos por defecto.** Mientras nadie guarde desde el panel, la API pública
responde 503. El panel muestra un horario inicial (Lun a Vie de 09:00 a 17:00) con el aviso
"Aún no se muestra en el sitio" y el botón de guardar activo: al guardarlo queda publicado.

Para probar sin configurar Google, crea `data/schedule.json` a mano:

```json
{
  "timezone": "America/Santiago",
  "days": {
    "0": { "open": "09:00", "close": "13:00", "closed": true },
    "1": { "open": "09:00", "close": "17:00", "closed": false },
    "2": { "open": "09:00", "close": "17:00", "closed": false },
    "3": { "open": "09:00", "close": "17:00", "closed": false },
    "4": { "open": "09:00", "close": "17:00", "closed": false },
    "5": { "open": "09:00", "close": "17:00", "closed": false },
    "6": { "open": "09:00", "close": "13:00", "closed": true }
  },
  "exceptions": []
}
```

`data/banner.json` es opcional: si no existe, se publica sin anuncio. El backend relee los
archivos en cada petición, así que no hace falta reiniciarlo.

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
| `DATA_DIR` | no | Carpeta de `schedule.json` y `banner.json`. Por defecto `./data`; en la VM, `/var/lib/coyote` (fuera del repo). |

Generar un secreto:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## Endpoints

### Público (sin sesión, CORS abierto, sin caché)

`GET /api/public/site-config`

```json
{
  "schedule": { "timezone": "America/Santiago", "days": { "1": { "open": "09:00", "close": "17:00", "closed": false } }, "exceptions": [] },
  "banner":   { "enabled": true, "message": "...", "linkUrl": "cotizador.html", "speed": "normal", "startsAt": null, "endsAt": null },
  "status":   { "isOpen": true, "text": "Abierto hoy hasta 17:00", "summary": "Lun a Vie: 09:00 a 17:00 hrs" },
  "updatedAt": "2026-09-09T12:00:00.000Z"
}
```

| Situación | Respuesta |
|---|---|
| Horario guardado | 200 con `Cache-Control: no-cache` |
| `schedule.json` no existe, está dañado o no cumple las reglas del panel (por ejemplo, le falta un día) | **503** con `no-store`: el sitio no muestra horario ni anuncio |
| `banner.json` no existe, está dañado o no cumple las reglas del panel (por ejemplo, un enlace `javascript:`) | 200 con el banner desactivado |

Un archivo editado a mano nunca se completa con valores por defecto: o cumple lo mismo que
exige el panel al guardar, o no se publica.

Se entrega el horario completo y el banner con su ventana de vigencia, no el resultado: el
estado abierto/cerrado y la vigencia del banner son función de la hora actual, así que los
decide el navegador con su reloj y una pestaña abierta cambia sola. `status` va solo para
depurar; el sitio no lo lee. El correo de quien hizo el último cambio **no** se expone aquí.

`GET /health` — comprobación de vida.

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

Los `GET` llevan `published`. Si el archivo no existe o está dañado responden igual 200, con
los valores iniciales y `published: false`, para que el panel pueda cargar y guardar. Leer
nunca sobrescribe un archivo dañado; solo lo reemplaza un guardado.

---

## Pruebas

```bash
npm test
```

Las pruebas viven en el proyecto hermano `tests-backend-coyote-s-house/`, fuera de este
repositorio: la suite de paridad compara este backend contra el sitio público, así que no
pertenece del todo a ninguno de los dos. `npm test` desde aquí las invoca igual.

Dos suites, sin dependencias de desarrollo:

- **`api.test.mjs`** — el arranque sin datos (503 y valores iniciales en el panel), control de
  acceso, validaciones, guardado y publicación, archivos dañados y que el backend no sirva el
  sitio, usando `fastify.inject` (sin abrir puertos). Trabaja en una carpeta de datos temporal
  y nunca toca `data/`.
- **`paridad.test.mjs`** — compara `src/lib/schedule-status.js` (servidor) contra
  `coyote-s-house/js/lib/site-config.js` (navegador) barriendo una semana completa en pasos
  de 90 minutos sobre 10 horarios distintos: **1.280 comparaciones**. Se omite sola si el
  sitio público no está en `../coyote-s-house`.

  Esa segunda suite existe por una razón concreta: el sitio público no puede importar código
  de este backend, así que la lógica de "abierto/cerrado" está escrita dos veces. Si las dos
  versiones divergen, el sitio afirma una cosa y la API otra, y nadie se entera hasta que un
  cliente llega al taller cerrado. Si tocas una, corre esta prueba.

---

## Estructura

```
src/
├── server.js              Arranque, manejo de errores, archivos del panel
├── config.js              Lee y valida el entorno; falla temprano y con motivo
├── plugins/
│   ├── auth.js            Google OAuth, sesión JWT y guardia requireAdmin
│   └── security.js        Helmet (CSP), límite de peticiones
├── routes/                public / auth / admin
├── repositories/          schedule.repo.js y banner.repo.js sobre json-store.js
├── schemas/               JSON Schema + reglas de negocio en español
└── lib/
    ├── defaults.js        Valores iniciales del formulario del panel (nunca se publican)
    ├── schedule-status.js Cálculo de abierto/cerrado en America/Santiago
    └── public-config.js   El JSON que publica /api/public/site-config
public/admin/              Panel: HTML, CSS y JS sin build ni dependencias
data/                      schedule.json y banner.json (fuera de git)
```

---

## Almacenamiento

Los datos son dos archivos JSON y no hay base de datos: son un horario semanal y un banner,
y si se perdieran se vuelven a cargar desde el panel en un par de minutos.

- **Sin valores por defecto.** Un archivo que no existe no se crea al leer: se informa, y
  cada ruta decide (la API pública responde 503, el panel ofrece los valores iniciales).
- **Escritura atómica.** Se escribe un archivo temporal y después se renombra sobre el
  definitivo: si el proceso muere a mitad, el JSON anterior queda intacto.
- **Escrituras en cola por archivo.** Dos guardados simultáneos se aplican uno tras otro.
- **Un solo proceso.** La cola vive en memoria, así que el backend debe correr como una única
  instancia (así lo levanta systemd en la VM).
- **Fuera del repo en producción.** `DATA_DIR=/var/lib/coyote`, para que ni un `git clean`
  ni volver a clonar se lleven los datos.

Solo se guarda el último cambio (`updatedAt` y `updatedBy`), no un historial.

---

## Desplegar

El backend corre en la VM de Oracle (Linux ARM) como servicio de systemd, detrás de nginx y
Cloudflare. El procedimiento está en [`despliegue.md`](despliegue.md), pendiente de
reescribir tras quitar Neon y Vercel. Lo esencial:

1. `NODE_ENV=production`, `PUBLIC_BASE_URL=https://coyoteshouse.cl` y
   `DATA_DIR=/var/lib/coyote` en el entorno del servicio, con permiso de escritura sobre esa
   carpeta en la unidad de systemd.
2. Agregar `https://coyoteshouse.cl/auth/google/callback` a las credenciales de Google.
3. nginx: servir el sitio estático y reenviar `/api/`, `/admin`, `/auth/` y `/health` a
   Fastify.
4. Cloudflare: regla "Bypass cache" para esas mismas rutas.
5. Primer despliegue: entrar al panel y guardar el horario (o copiar el `schedule.json` real a
   `/var/lib/coyote`). Hasta entonces el sitio no muestra horario ni anuncio.
