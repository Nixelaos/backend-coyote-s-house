# Fase B — handoff para continuar con el paso 3

Continuación de [`despliegue.md`](despliegue.md) (sección 9, fase B). Escrito el 2026-09-11 al
cerrar el paso 1 y actualizado el mismo día al cerrar el paso 2, para que una sesión nueva
arranque el paso 3 sin reconstruir contexto.

**Léelo entero antes de tocar código.** La sección 10 tiene el prompt para abrir el chat.

---

## 1. Contexto en treinta segundos

Coyote's House es un taller de motos en Macul. Tres repos hermanos en `Desktop/coyoteshouse/`:

| Carpeta | Qué es | Git |
|---|---|---|
| `coyote-s-house/` | Sitio público: HTML estático + web components (todo se renderiza en el navegador) | `Nixelaos/coyote-s-house`, público |
| `backend-coyote-s-house/` | Fastify 5 + Neon Postgres + panel `/admin` con login Google. Edita horario y banner | `Nixelaos/backend-coyote-s-house`, **privado** |
| `tests-backend-coyote-s-house/` | Las tres suites. Viven fuera porque `paridad.test.mjs` compara los otros dos repos | `Nixelaos/tests-backend-coyote-s-house` |

Producción: VM Oracle ARM (2 OCPU / 12 GB, Always Free en cuenta PAYG) con nginx sirviendo el
sitio detrás de Cloudflare. **El backend todavía no está desplegado** — eso es la fase C, después
de terminar la fase B.

Objetivo de la fase B: que el horario y el banner lleguen **dentro del HTML** (sin `fetch`, sin
parpadeo, sin hardcode en el sitio), que el HTML se cachee en nginx y Cloudflare, y que guardar
desde el panel purgue Cloudflare. Fundamento completo en `despliegue.md` (segunda corrección y
secciones marcadas ⚠️).

---

## 2. Estado exacto al momento del handoff

### Hecho y verificado

- Fase A completa salvo Google Console: 4.1 push, 4.3 esquema + semilla en Neon `production`
  (verificado por MCP), 4.4 `@neon/*` a devDependencies.
- **Paso 1 de la fase B — espejo JSON** (2026-09-11):
  - `src/repositories/mirror-store.js` (nuevo): store `{ get, save, hydrate }` que envuelve
    Neon (primario) y JSON (espejo). `get()` lee el espejo y solo va a Neon si falta o está
    corrupto. `save()` escribe Neon → espejo; si el espejo falla tras aceptar Neon, lanza
    `EMIRROR` con mensaje claro. `hydrate()` devuelve `'espejo'` | `'primario'`.
  - `json-store.js`: opción `seedOnMissing` (false = ENOENT se propaga, no siembra defaults).
  - `schedule.repo.js` / `banner.repo.js`: con `STORAGE_DRIVER=neon` usan el store espejado;
    con `json` **nada cambia**. Ambos exponen `hydrate()`.
  - `server.js`: hook `onReady` que hidrata ambos espejos solo con driver `neon`; no fatal.
  - `config.js`: `DATA_DIR` mueve `paths.data` (Vercel: `/tmp/coyote-data`).
  - `mirror.test.mjs` (29 pruebas, sin red, primario en memoria). README, `.env.example` y
    `despliegue.md` actualizados.
  - Verificado con humo real: arranque con `neon` + `DATA_DIR` a una carpeta temporal →
    `origen: primario` en ambos recursos, `GET /api/public/site-config` 200 con 7 días, segunda
    lectura desde disco. Solo lecturas contra producción.
  - Commiteado: `289ae0e` (código) y `fd5ffb5` (docs).
- **Paso 2 de la fase B — render de HTML** (2026-09-11):
  - `src/routes/site.routes.js` (nuevo): `GET /` y `GET /<pagina>.html` para las 9 páginas (10
    rutas explícitas, `helmet: false` por ruta hasta el paso 3). Lee el archivo de `SITE_ROOT`,
    inyecta el bloque `<script type="application/json" id="coyote-config">` antes de `</head>`,
    reescribe el JSON-LD de `index.html` y responde `public, max-age=0, s-maxage=3600`. Espejo
    ilegible → **503** con HTML mínimo, `no-store` y `Retry-After: 30`. Repositorios y carpeta
    inyectables por opciones (así se prueba el 503 sin tocar disco).
  - `src/lib/site-pages.js` (nuevo): lista cerrada de páginas, carpetas de estáticos,
    `isPublicSitePath()`. **La reutiliza el paso 6** para armar las URLs de la purga.
  - `src/lib/public-config.js` (nuevo): `buildPublicConfig(schedule, banner)`, un solo JSON para
    el HTML y para `/api/public/site-config`.
  - `src/lib/site-render.js` (nuevo, puro): inyección del bloque, reescritura del JSON-LD y
    escapado del JSON embebido (`<` y U+2028/U+2029 como secuencias JSON, para que un mensaje
    de banner no pueda cerrar el `</script>`).
  - `public.routes.js`: usa `buildPublicConfig` + `status`; ya no evalúa la ventana del banner.
  - `server.js`: fuera el redirect de `/` a `/admin/`; `siteRoutes` + segunda instancia de
    `@fastify/static` (`allowedPath` solo `css/ js/ assets/ fonts/`), ambos solo si
    `status.hasSite`.
  - `config.js`: `SITE_ROOT` → `paths.site`; `validateConfig()` devuelve `hasSite`.
  - `security.js`: el `allowList` del rate limit cubre páginas y estáticos.
  - `banner.repo.js`: solo cambió el comentario de `resolveBannerVisibility()` (queda como
    implementación de referencia para la paridad del paso 4).
  - `api.test.mjs`: 23 → 51 pruebas (sección "Sitio público" y "espejo ilegible").
  - README, `.env.example`, `despliegue.md` 5.2 (`SITE_ROOT`) actualizados.
  - Verificado con `fastify.inject` y con HTTP real en local, driver json: páginas 200 con
    bloque y JSON-LD reescrito, 404 JSON fuera de la lista, `/../package.json` 404, estáticos
    200, `/admin` sigue redirigiendo, sin cabecera CSP en las páginas. **Queda pendiente la
    comprobación en navegador** (ver §3).

### Sin commit (el usuario commitea)

Backend: `.env.example`, `README.md`, `despliegue.md`, `fase-b.md`, `src/config.js`,
`src/server.js`, `src/plugins/security.js`, `src/routes/public.routes.js`,
`src/repositories/banner.repo.js`, y nuevos `src/lib/site-pages.js`, `src/lib/public-config.js`,
`src/lib/site-render.js`, `src/routes/site.routes.js`.

Tests: `api.test.mjs`.

Mensajes sugeridos:

```bash
cd backend-coyote-s-house
git commit -am "feat: servir el sitio con horario y banner dentro del HTML (fase B, paso 2)"   # + git add de los nuevos

cd ../tests-backend-coyote-s-house
git commit -am "test: render del sitio público (bloque, JSON-LD, 404, 503)"
```

Los avisos `LF will be replaced by CRLF` son de `core.autocrlf` en Windows; ignorarlos.

### Pendiente fuera de la fase B (no tocar ahora)

- 4.6: agregar `https://coyoteshouse.cl/auth/google/callback` en Google Console. Allowlist
  queda con `nnicolaslf@gmail.com` solo, por decisión del 11/09.
- Toda la fase C (VM). `despliegue.md` sección 9 tiene el orden.

---

## 3. Antes de escribir una línea

```bash
cd backend-coyote-s-house
npm test        # debe dar: 29 OK / 51 OK / 1280 comparaciones, 0 fallas
git status      # limpio si ya se commiteó lo de la sección 2
```

`npm test` desde el backend delega a `../tests-backend-coyote-s-house/`. También se puede
correr `npm test` desde esa carpeta. No hay framework: cada suite usa un `check(nombre,
condicion, extra)` propio y termina con `N pruebas OK, M fallidas` + `process.exit`. Mantener
ese formato.

**Comprobación en navegador pendiente del paso 2** (no se pudo hacer desde el chat):

```bash
STORAGE_DRIVER=json npm run dev      # y abrir http://localhost:3000/
```

Debe verse el sitio completo (CSS, fuentes, componentes) sin errores de CSP en la consola, y
"ver código fuente" debe mostrar el bloque `coyote-config` justo antes de `</head>`. Ojo: el
`site-config.js` actual sigue haciendo `fetch` a `/api/public/site-config`, así que hasta el
paso 4 el topbar toma el horario de la API y no del bloque. Es lo esperado.

---

## 4. Diseño acordado (resumen operativo)

Principio rector: **nunca datos falsos**. Cada capa sirve el último dato real o falla.

```
Panel /admin ──► Fastify ──► Neon (verdad) ──► data/*.json (espejo)      [paso 1, hecho]
                                                     │
Visitante ──► Cloudflare ──► nginx proxy_cache ──► Fastify lee el espejo, inyecta en el HTML
              (TTL finito,    (30 s fresco,         y responde 5xx si el espejo no se puede leer
               purga al       use_stale si
               guardar)       Fastify cae)
```

Simplificación importante decidida el 11/09: **no se renderizan componentes en Node.** El sitio
entero ya son web components que pintan en el cliente. Lo que elimina el parpadeo y el CLS es
que pinten **una sola vez con los datos correctos**, y eso se logra inyectando los datos en el
HTML antes de que corran, no duplicando plantillas en dos lenguajes.

Los ocho pasos (tabla completa en `despliegue.md` §9):

| # | Paso | Estado |
|---|---|---|
| 1 | Espejo JSON | ✅ |
| 2 | Render de HTML: `site.routes.js` + `SITE_ROOT` | ✅ |
| 3 | CSP distinta para el sitio público | **siguiente** |
| 4 | `site-config.js` sin `fetch`, `sessionStorage` ni `CONFIG_POR_DEFECTO` | |
| 5 | `/admin` estático → `private, no-store` | |
| 6 | Purga de Cloudflare al guardar | |
| 7 | `despliegue.md` 5.5 (`proxy_cache`) y 5.7 (Cache Rules) | |
| 8 | Pruebas de todo lo anterior | |

Modo de trabajo acordado con el usuario: **paso a paso**, mostrar el resultado, seguir al
siguiente solo con su aprobación.

---

## 5. Paso 2 (hecho) — decisiones tomadas y lo que heredan los pasos 3 y 4

### Decisiones cerradas el 11/09 con el usuario

- **Banner con `startsAt`/`endsAt`: decide el navegador, TTL fijo (opción B).** El bloque y la
  API llevan el banner guardado con sus fechas; `enabled` significa "interruptor encendido y
  mensaje no vacío". La ventana **no** se evalúa en el servidor. Razón: la misma copia cacheada
  tiene que ser correcta antes, durante y después de la vigencia, igual que el HTML lleva el
  horario y no el estado abierto/cerrado. Descartadas: TTL dinámico hasta la próxima
  transición (A) y "ambas" (C: una vez que el cliente evalúa, el TTL dinámico no aporta nada).
  Límites de purga de Cloudflare verificados en su documentación: purga por URL disponible en
  el plan Free, 100 URLs por petición, 800 URLs por segundo, 1.200 llamadas a la API cada 5
  minutos. Una persona guardando desde el panel no se acerca.
  **Hereda el paso 4:** `site-config.js` porta `resolveBannerVisibility()` de `banner.repo.js`
  (que queda como implementación de referencia); `getBanner()` devuelve la vista ya resuelta
  para que `announcement-banner.js` no cambie; y se vuelve a disparar `siteconfig:ready` con un
  `setTimeout` a la próxima transición, para que una pestaña abierta cambie sola.
  `paridad.test.mjs` compara las dos implementaciones, como hace con `calcularEstado()`.
- **`/api/public/site-config` devuelve el mismo JSON que el bloque, más `status`.** Una sola
  función `buildPublicConfig()`. Cambió la prueba "un banner que aún no empieza no se publica":
  ahora comprueba que viaja con sus fechas.
- **CSP:** las rutas del sitio llevan `helmet: false` (opción de ruta de `@fastify/helmet`,
  la lee un hook `onRoute`). **El paso 3 reemplaza ese `false`** en `site.routes.js` por un
  objeto con la CSP del sitio; el resto de helmet sigue global.
- **Punto de inyección: justo antes de `</head>`**, después del JSON-LD. El paso 4 debe cargar
  `site-config.js` sin `defer` **después** del bloque: como primer `<script>` del `<body>`, o
  al final del `<head>`.
- `SITE_ROOT` ausente: error de arranque si la variable está definida y la carpeta no existe;
  aviso (y sin sitio) si falta el default `../coyote-s-house`, que es el caso de Vercel.
- `/../package.json` responde 404: `@fastify/static` rechaza rutas no canónicas antes de
  consultar `allowedPath`, y `fastify.inject` normaliza la URL. La prueba acepta 403 o 404.

Lo que sigue es el diseño previo al paso, conservado como registro de por qué se hizo así.

### Qué hace

Nuevo `src/routes/site.routes.js`. Para `GET /` y `GET /<pagina>.html`:

1. Lee el archivo desde `SITE_ROOT` (nueva variable en `config.js`; por defecto
   `path.resolve(ROOT_DIR, '..', 'coyote-s-house')`, que es el repo hermano en desarrollo).
2. Obtiene horario y banner por los repositorios (o sea, del espejo).
3. Inyecta **antes de `</head>`**:
   ```html
   <script type="application/json" id="coyote-config">{"schedule":{...},"banner":{...},"updatedAt":"..."}</script>
   ```
   Misma forma que hoy devuelve `/api/public/site-config` — **conviene extraer esa
   construcción de `public.routes.js` a una función compartida** y que ambos la usen.
4. Reescribe el bloque `<script type="application/ld+json">` donde exista (hoy solo en
   `index.html`) para que `openingHoursSpecification` refleje el horario real. La lógica ya
   existe en el cliente: `actualizarDatosEstructurados()` en
   `coyote-s-house/js/lib/site-config.js`; portarla al servidor.
5. Responde con `Cache-Control: public, max-age=0, s-maxage=3600` (el navegador revalida
   siempre; Cloudflare cachea 1 h; nginx ignorará esta cabecera y usará su propio TTL de 30 s —
   ver paso 7).
6. **Si el espejo no se puede leer, responde 503** con `Cache-Control: no-store`. Esto invierte
   deliberadamente el "nunca falles" de `public.routes.js`: con una caché delante, servir
   `DEFAULT_SCHEDULE` envenenaría la caché con datos inventados; un 503 hace que
   `proxy_cache_use_stale` sirva la última página buena.

### Detalles que había que resolver (todos resueltos; ver las decisiones de arriba)

- **Lista cerrada de páginas.** Solo las 9 que existen: `index`, `caso-ajuste-motor`,
  `contacto`, `cotizador`, `faq`, `galeria`, `resenas`, `servicios`, `sobre-alberto`. Nada de
  leer cualquier ruta que termine en `.html`: sin allowlist hay path traversal. Lo que no está
  en la lista → 404 con el mismo JSON de `setNotFoundHandler`.
- **Estáticos en desarrollo.** Para que `localhost:3000/` se vea bien sin nginx, Fastify tiene
  que servir también `css/`, `js/`, `assets/`, `fonts/` desde `SITE_ROOT` — segunda instancia de
  `@fastify/static` con `decorateReply: false` (ya hay una para `/admin/`). En la VM nginx los
  sirve antes y esto no estorba.
- **La ruta `/` hoy redirige a `/admin/`** (`server.js`, `fastify.get('/')`). Hay que quitar ese
  redirect: `/` pasa a ser el sitio.
- **Rate limit.** Las páginas entran al cupo global de 300/min. Con `proxy_cache` el origen
  recibe poco, pero una purga provoca ráfaga. Agregar `/` y `*.html` al `allowList` de
  `security.js` (como ya está `/api/public/`), o subir el cupo para esas rutas.
- **`status` no va en el bloque.** Es función de la hora actual; el cliente lo recalcula cada
  minuto desde `schedule` (`calcularEstado()`). Inyectarlo solo invita a confiar en un valor
  cacheado y viejo.
- **El banner con `startsAt`/`endsAt` es un problema real con caché.** Hoy la vigencia se
  evalúa en el servidor. Si el HTML está cacheado 1 h y el banner empieza a las 10:00, aparece
  hasta las 11:00. La purga al guardar no ayuda: la transición no dispara ningún guardado.
  Recomendación original (decidir con el usuario, no asumir):
  - calcular `s-maxage` dinámico = `min(3600, segundos hasta la próxima transición del
    banner)`, para que la caché venza exactamente cuando cambia; y además
  - mandar `startsAt`/`endsAt` en el bloque y que el cliente también evalúe la ventana. El
    comentario en `banner.repo.js` que justifica evaluar solo en servidor (reloj del visitante
    mal puesto) pesa poco frente a una marquesina.

  **Resuelto: solo lo segundo (opción B).** Ver "Decisiones cerradas" arriba.
- **CSP.** `index.html` tiene `style="..."` inline y `security.js` registra helmet global con
  `styleSrc` sin `'unsafe-inline'`: servido por Fastify, **el sitio se rompe**. Es el paso 3,
  pero el 2 no se puede probar en el navegador sin resolverlo. Mínimo viable en el paso 2:
  registrar `site.routes.js` en un scope donde helmet no aplique o con `config.helmet` por
  ruta; la CSP definitiva del sitio se decide en el 3.
- **JSON-LD y `<script type="application/json">` no los bloquea `script-src`**: son bloques de
  datos, no ejecutables. Lo que sí bloquearía es un `<script>` inline con código; por eso en el
  paso 4 `site-config.js` sigue siendo archivo externo, cargado en `<head>` sin `defer`, **después**
  del bloque JSON.
- **Ruta del docroot en la VM.** `SITE_ROOT` en producción apunta a la carpeta que sirve nginx.
  No está documentada; se averigua con `grep -rn "root " /etc/nginx/` en la VM. Va en
  `despliegue.md` 5.2 cuando se sepa.

### Pruebas del paso 2 (hechas: 28 nuevas en `api.test.mjs`)

- `GET /` → 200, `content-type: text/html`, contiene `id="coyote-config"`, el JSON parsea y
  tiene `schedule.days` con 7 claves y `banner`.
- `GET /index.html` → mismo resultado. `GET /contacto.html` → 200 con bloque.
- `GET /no-existe.html` y `GET /../package.json` → 404 (JSON del not-found handler).
- `Cache-Control` de una página: `public` con `s-maxage`.
- JSON-LD de `/` refleja el horario del espejo (no el hardcodeado de la plantilla).
- El 503 con espejo ilegible es difícil de provocar con el driver `json` (siembra defaults).
  Opción: probar la función de render aislada con un repositorio falso que lanza. No forzar una
  prueba de integración artificial.

---

## 6. Pasos 3–8, lo esencial

- **3 — CSP.** ⭐ **Plan detallado y ya investigado en [`paso-3-csp.md`](paso-3-csp.md)**: qué carga
  el sitio archivo por archivo, la política completa, cómo la aplica helmet por ruta, las pruebas
  y una decisión pendiente (dos manejadores `on*` en línea que la política bloquea). Leerlo en vez
  de rehacer la investigación. En resumen: helmet estricto queda para `/admin` y `/auth`; el sitio
  necesita `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`, `font-src` con
  `fonts.gstatic.com`, `img-src 'self' data:` y `frame-src` con los dos orígenes del mapa. Hoy en
  producción el sitio **no tiene CSP** (lo sirve nginx a secas), así que cualquier CSP razonable
  es una mejora, no una regresión.
- **4 — `site-config.js`.** Lee `document.getElementById('coyote-config')` de forma síncrona.
  Fuera `fetch`, `sessionStorage`, `CONFIG_POR_DEFECTO`, `API_BASE`. Si el bloque no existe
  (alguien abrió el HTML desde disco) → estado "sin horario": topbar y banner ocultos, sin
  inventar. `calcularEstado()`, `resumirHorario()`, `detalleHorario()` y la API
  `window.CoyoteSiteConfig.{get,getStatus,getSummary,getDetail,onReady}` se conservan: **ningún
  componente cambia**. El `<script>` se mueve a `<head>` sin `defer`, después del bloque.
  Actualizar `paridad.test.mjs`: evalúa `site-config.js` en un `vm` con `sessionStorage`
  simulado — cambiará a inyectar el bloque en el DOM simulado.
- **5 — `/admin` estático.** `server.js` hook `onSend`: `no-cache` → `private, no-store`.
- **6 — Purga.** Nuevo `src/lib/cloudflare-purge.js`: `POST
  https://api.cloudflare.com/client/v4/zones/{CLOUDFLARE_ZONE_ID}/purge_cache` con `{"files":
  [...]}` y `Authorization: Bearer {CLOUDFLARE_API_TOKEN}` (token con alcance solo *Zone → Cache
  Purge*; lo crea el usuario, va en `/etc/coyote/backend.env`, nunca en el chat). Lista de URLs:
  **18** — las 9 páginas × 2 hosts, porque `www.coyoteshouse.cl` responde 200 directo sin
  redirigir al apex (verificado 11/09). Incluir `/` y `/index.html` como entradas distintas.
  Se llama desde los dos `PUT` de `admin.routes.js` **después** del `save()`, best-effort: nunca
  falla el guardado; la respuesta lleva `purged: true|false` y el panel (`public/admin/admin.js`)
  avisa "guardado, pero la caché no se pudo limpiar: puede tardar hasta 1 h". Sin variables de
  Cloudflare configuradas (desarrollo), `purged: null` y no se intenta.
- **7 — Doc.** `despliegue.md` 5.5: bloque nginx con `location = /` y `location ~ \.html$` al
  backend, `proxy_cache_path ... inactive=30d`, `proxy_cache_valid 200 30s`,
  `proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504`,
  `proxy_cache_background_update on`, `proxy_cache_lock on`, y **`proxy_ignore_headers
  Cache-Control Expires`** para que nginx use sus 30 s y no el `s-maxage` de 1 h. 5.7: regla 1
  (bypass `/api`, `/auth`, `/admin`) intacta; regla 2 nueva: elegible para caché el HTML
  público, respetando el TTL del origen. `SITE_ROOT` en 5.2.
- **8 — Pruebas.** Todo lo anterior cubierto; `npm test` en verde en ambos repos.

---

## 7. Hechos verificados (no volver a verificar salvo sospecha)

| Hecho | Fuente |
|---|---|
| Backend no desplegado: `/health`, `/admin/`, `/api/*` → 404 HTML de nginx | curl 11/09 |
| Front en la VM en `8a5f346` (26/08), dos commits atrás; `site-config.js` da 404 en vivo | curl 11/09 |
| Cloudflare: HTML `cf-cache-status: DYNAMIC`; CSS `max-age=14400`; SSL en **Full** (no strict) | curl + usuario |
| nginx sin `set_real_ip_from` | usuario |
| `www.coyoteshouse.cl` → 200 directo; `http://` → 301 a `https://coyoteshouse.cl/` | curl 11/09 |
| Google Console: solo la URI de localhost | usuario |
| Neon `production` (`br-shiny-mouse-acxls5cn`, endpoint `ep-bold-dawn-ac7xgnqy`, `aws-sa-east-1`, PG 18): 4 tablas, 7 días sembrados, banner apagado. PITR **6 h**. Scale-to-zero | MCP 11/09 |
| Neon `dev` (`br-raspy-leaf-acxjfpas`): también con tablas | MCP 11/09 |
| Backend privado en GitHub (404 sin auth); decidido: deploy key para el usuario `coyote` | curl + doc 4.2 |
| Herramienta MCP de Neon disponible con acceso admin; `org_id` = `org-lucky-grass-14735281`, `project_id` = `frosty-block-22445989` | MCP |

---

## 8. Convenciones y preferencias del usuario

- **Todo en español**: comentarios, docs, mensajes de error, nombres de pruebas. El código ya
  mezcla identificadores en inglés (`scheduleRepository`) y español (`leerHorario`); seguir el
  estilo del archivo que se toca.
- Comentarios densos que explican el *por qué*, no el qué. Mirar `mirror-store.js` o
  `json-store.js` como referencia de tono.
- ESM puro, Node ≥ 20.11, sin TypeScript, sin build, sin framework de pruebas.
- **El usuario prefiere discutir antes de implementar.** Dice "analicemos" cuando quiere solo
  texto, y da instrucciones directas cuando quiere acción. Ante una decisión de diseño con
  trade-offs, exponerla y esperar. Ante una instrucción clara, ejecutar.
- Valora que se le contradiga con evidencia. Verificar con `curl`/MCP antes de afirmar estados
  del sistema; no dar por hecho lo que dicen los docs.
- **No commitear ni pushear sin que lo pida.** Él commitea desde VS Code con frecuencia; si algo
  aparece commiteado sin explicación, probablemente fue él.
- **No pegar secretos en el chat.** `.env` existe localmente con `DATABASE_URL` de producción;
  leer solo nombres de variables, nunca valores. Cuando haga falta un token nuevo (Cloudflare),
  explicarle cómo crearlo y dónde ponerlo, no pedírselo.
- Windows 11, VS Code, Git Bash como shell. `os.tmpdir()` funciona; los `.tmp` de `writeAtomic`
  se limpian solos.

---

## 9. Cosas que NO hacer

- No hacer `git pull` del sitio en la VM: desplegaría un `site-config.js` con `fetch` a una
  API que no existe, y que el paso 4 reescribe. Va al final de la fase C.
- No desplegar el backend. Fase C, y solo con la fase B completa.
- No correr `api.test.mjs` con `STORAGE_DRIVER=neon` contra producción. La suite tiene una
  guarda que aborta si detecta el `DATABASE_URL` de producción; respetarla. Para probar contra
  Neon usar `DATABASE_URL_TEST` (rama `dev`).
- No renderizar componentes en Node. Se descartó (sección 4).
- No generar HTML en `/var/www` al guardar. Se descartó: choca con `ProtectSystem=strict` y
  SELinux.
- No borrar `/api/public/site-config`: el panel no lo usa, pero es inofensivo y sirve para
  depurar. Sí conviene que comparta la función de construcción con `site.routes.js`.
- No agregar `'unsafe-inline'` a `script-src` en ninguna parte. Estilos sí, scripts no.

---

## 10. Prompt sugerido para el chat nuevo

> Lee `backend-coyote-s-house/fase-b.md` y `backend-coyote-s-house/paso-3-csp.md` completos.
> Estamos en la fase B del proyecto Coyote's House; los pasos 1 y 2 están hechos. Verifica que
> `npm test` pasa en `backend-coyote-s-house`. El paso 3 (CSP del sitio público) ya está
> investigado y planificado en `paso-3-csp.md`: recuérdame la decisión pendiente de su sección 2
> y espera mi respuesta antes de escribir código.
