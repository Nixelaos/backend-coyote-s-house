# Backend y Panel de Coyote's House

Backend en **Fastify** que permite al taller editar su **horario de atención** y publicar un
**banner de anuncios** en el sitio, sin tocar código ni hacer despliegues.

```
Panel /admin  ──login Google──►  Fastify  ──►  repositorio  ──►  data/*.json   (hoy)
                                    │                        └──►  Neon Postgres  (después)
                                    │
Sitio público (Netlify) ◄──GET /api/public/site-config
```

**Regla de oro del diseño:** si este backend se cae, el sitio público sigue funcionando y
muestra el horario de respaldo. Nunca se rompe la página por culpa del panel.

---

## Puesta en marcha

```bash
npm install
cp .env.example .env      # y completar los valores (ver abajo)
npm run dev
```

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
| `STORAGE_DRIVER` | no | `json` (actual) o `neon` (futuro). |

Generar un secreto:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## Endpoints

### Público (sin sesión, CORS abierto, cacheado 60 s)

`GET /api/public/site-config`

```json
{
  "schedule": { "timezone": "America/Santiago", "days": { "1": { "open": "09:00", "close": "17:00", "closed": false } }, "exceptions": [] },
  "banner":   { "enabled": true, "message": "...", "linkUrl": "cotizador.html", "speed": "normal" },
  "status":   { "isOpen": true, "text": "Abierto hoy hasta 17:00", "summary": "Lun a Vie: 09:00 a 17:00 hrs" },
  "updatedAt": "2026-09-09T12:00:00.000Z"
}
```

Se entrega el horario completo **y** el estado ya calculado: el estado sirve para pintar sin
parpadeo, y con el horario completo el navegador recalcula cada minuto sin volver a pedir
nada. El correo de quien hizo el último cambio **no** se expone aquí.

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

Dos suites, sin dependencias de desarrollo:

- **`test/api.test.mjs`** — control de acceso, validaciones y guardado, usando
  `fastify.inject` (sin abrir puertos). Restaura los datos al terminar.
- **`test/paridad.test.mjs`** — compara `src/lib/schedule-status.js` (servidor) contra
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
├── routes/                public / auth / admin
├── repositories/          Interfaz { get, save } — el punto de cambio para Neon
├── schemas/               JSON Schema + reglas de negocio en español
└── lib/schedule-status.js Cálculo de abierto/cerrado en America/Santiago
public/admin/              Panel: HTML, CSS y JS sin build ni dependencias
data/                      schedule.json y banner.json (fuera de git)
```

---

## Migrar a Neon

Nada fuera de `src/repositories/` asume que hay archivos JSON. `schedule.repo.js` y
`banner.repo.js` exponen solo `get()` y `save(datos, usuario)`. Para migrar:

1. `npm i @neondatabase/serverless drizzle-orm`
2. Crear `src/repositories/neon-store.js` con esa misma interfaz.
3. Poner `STORAGE_DRIVER=neon` y `DATABASE_URL=...` en el `.env`.
4. Script de migración que lea los JSON y los inserte.

Rutas, esquemas y panel no se tocan. Tablas previstas: `schedule_days`,
`schedule_exceptions`, `banners` y `audit_log` (quién cambió qué y cuándo, que en JSON no
vale la pena pero en Postgres sale gratis).

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

> **Ojo con el disco.** En los planes gratuitos el sistema de archivos suele ser efímero: se
> borra en cada despliegue y con él los `data/*.json`. Antes de que el taller empiece a usar
> el panel en serio, conviene pasar a Neon o montar un volumen persistente. Si no, un
> despliegue devolvería el horario a los valores por defecto sin avisar.
