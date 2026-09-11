# Fase B, paso 3 — CSP para el sitio público

Plan escrito el 2026-09-11 al cerrar el paso 2, para retomarlo otro día sin volver a investigar.
Complemento de [`fase-b.md`](fase-b.md), que sigue siendo el handoff general de la fase.

**Nada de esto está implementado.** Hay una decisión pendiente (sección 2) que conviene resolver
antes de escribir código.

---

## 1. Antes de empezar

```bash
cd backend-coyote-s-house
npm test        # debe dar: 29 OK / 51 OK / 1280 comparaciones, 0 fallas
git status
```

Estado al escribir esto:

| Repo | Situación |
|---|---|
| `backend-coyote-s-house` | 4 commits sin push; el paso 2 completo **sin commitear** |
| `tests-backend-coyote-s-house` | 1 commit sin push; `api.test.mjs` **sin commitear** |
| `coyote-s-house` | limpio y sincronizado |

`origin/main` del backend sigue en `35ec1c8` (el adaptador de Vercel). Nada de la fase B está en
GitHub, y la VM clona desde ahí: eso bloquea la fase C hasta que se suba.

**Verificación pendiente del paso 2**, que conviene hacer junto con este paso porque se prueba lo
mismo en el navegador:

```bash
STORAGE_DRIVER=json npm run dev      # y abrir http://localhost:3000/
```

El sitio debe verse completo y "ver código fuente" debe mostrar el bloque `coyote-config` antes
de `</head>`. Hasta el paso 4 el topbar sigue tomando el horario por `fetch` a la API, no del
bloque: es lo esperado.

---

## 2. Decisión pendiente: dos manejadores de eventos en línea

La política bloquea dos atributos `on*` que hoy genera el JavaScript del sitio. No los bloquea
`script-src`, sino `script-src-attr 'none'`, que helmet agrega por defecto (verificado en
`node_modules/helmet/index.cjs:23`).

| Dónde | Qué hace | Qué pasa si se bloquea |
|---|---|---|
| `js/components/whatsapp-cotizador.js:309` | `onsubmit="return false;"` | Nada. Es código muerto: todos los botones del formulario son `type="button"` y, con varios campos, el navegador no envía de forma implícita. Solo queda un aviso en la consola. |
| `js/components/customer-reviews.js:192` | `onerror="this.remove();"` en la foto de quien reseña | Si la imagen falla queda el ícono de imagen rota en vez de desaparecer. Cosmético, y hoy ni se alcanza: las reseñas vienen de `/.netlify/functions/google-reviews`, que en la VM no existe. |

**Opción A (recomendada): arreglarlos.** Borrar el `onsubmit`, y cambiar el `onerror` por un
`addEventListener('error', ...)` sobre las imágenes después de pintarlas. Son unas seis líneas en
el repo del sitio. Ese repo no se había tocado, pero el paso 4 lo toca igual y nada llega a la VM
hasta la fase C.

**Opción B: dejarlos.** Cuesta dos avisos en consola y una degradación cosmética que hoy no se
alcanza. No se toca el sitio todavía.

**Lo que NO es opción:** relajar `script-src` con `'unsafe-inline'` o `'unsafe-hashes'`. La
sección 9 de `fase-b.md` lo prohíbe explícitamente: estilos sí, scripts no.

---

## 3. Qué carga el sitio (verificado archivo por archivo el 11/09)

| Recurso | Origen | Dónde |
|---|---|---|
| Hoja de tipografías | `https://fonts.googleapis.com` | las 9 páginas |
| Archivos de tipografía | `https://fonts.gstatic.com` | derivado de la hoja |
| Mapa en iframe | `https://maps.google.com` → **301** → `https://www.google.com/maps/embed` | `js/components/contact-location.js:109` |
| Imágenes | locales (`assets/`) | todas |
| Fotos de perfil de reseñas | `googleusercontent.com`, solo si la API de reseñas funcionara | `js/components/customer-reviews.js:192` |
| `fetch` | siempre al mismo origen (`/.netlify/functions/google-reviews`, `/api/public/site-config`, páginas en `main.js`) | — |

Lo que **no** hay: scripts en línea en el HTML (cero), bloques `<style>`, CSS externo fuera de las
tipografías, `data:` URIs, WebSockets, analítica. Los enlaces a WhatsApp, Instagram, Facebook,
Waze y Google Maps son navegación, y la CSP no restringe navegación.

**Estilos en línea: más de 50 líneas en 11 archivos** (4 en `index.html`, el resto dentro del
`innerHTML` de los componentes). Pasarlos a clases es reescribir el sitio y arriesgar regresiones
visuales, que no es para lo que sirve este paso. Por eso `style-src` lleva `'unsafe-inline'`.
Nota fina: `element.style.setProperty()` (por ejemplo `fijarAltura()` en el banner) **no** lo
restringe la CSP; lo que sí restringe es el atributo `style="..."` que llega por `innerHTML`.

Hoy en producción el sitio **no manda ninguna política de contenido** (verificado con curl el
11/09; sí manda `x-frame-options`, `x-content-type-options` y `referrer-policy` desde nginx). O
sea que cualquier política razonable es una mejora, no una regresión.

---

## 4. La política propuesta

```
default-src 'self'
script-src 'self'
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com
font-src 'self' https://fonts.gstatic.com
img-src 'self' data: https://*.googleusercontent.com
connect-src 'self'
frame-src https://maps.google.com https://www.google.com
frame-ancestors 'none'
object-src 'none'
base-uri 'self'
form-action 'self'
upgrade-insecure-requests        (solo en producción)
```

Por qué algunas:

- **Los dos orígenes del mapa.** El `src` del iframe apunta a `maps.google.com` y redirige con 301
  a `www.google.com`; la política se evalúa también contra el destino del redirect.
- **`googleusercontent`** cuesta cero y deja listas las fotos de reseñas si alguna vez se
  implementa ese endpoint en el backend. La CSP del panel ya lo permite por las fotos de Google.
- **`connect-src 'self'`** alcanza para todo: hasta el paso 4 `site-config.js` pide la API al
  mismo origen, porque Fastify sirve el sitio y la API juntos.

---

## 5. Cómo se aplica

En [`src/routes/site.routes.js`](src/routes/site.routes.js), reemplazar el `helmet: false` de cada
ruta por un objeto `helmet: { contentSecurityPolicy: { directives: { ... } } }`.

Verificado en `node_modules/@fastify/helmet/index.js` (líneas 45-48 y 66-70): la opción por ruta
hace `Object.assign({}, configuracionGlobal, configuracionDeRuta)`, o sea una **mezcla superficial
de primer nivel**. Consecuencias concretas:

1. El bloque `contentSecurityPolicy` se **sustituye entero**, no se fusiona con el global. Hay que
   declarar todas las directivas que se quieran.
2. El resto de cabeceras (HSTS, `referrer-policy`, `crossOriginResourcePolicy`, frameguard) se
   heredan del registro global. No hay que repetirlas.
3. **`upgradeInsecureRequests` hay que volver a declararlo** con la misma forma que en
   `src/plugins/security.js`: `config.isProduction ? [] : null`. Vivía dentro del bloque que se
   sustituye, y además helmet lo trae en sus directivas por defecto, así que sin el `null`
   explícito volvería a aparecer en desarrollo.

El panel (`/admin`), `/auth` y la API se quedan con la política estricta global, sin tocar nada.

Detalle menor: los estáticos del sitio (`css/`, `js/`, `assets/`, `fonts/`) los sirve la instancia
de `@fastify/static` registrada en `server.js` y salen con la política global estricta. No importa:
una CSP en una respuesta que no es un documento no se aplica como política de documento. Se puede
dejar así.

---

## 6. Pruebas (extender `api.test.mjs`)

- `GET /` trae cabecera `content-security-policy`.
- Esa política tiene `style-src` con `'unsafe-inline'` y `script-src 'self'`.
- **Guarda permanente:** falla si `script-src` llegara a incluir `'unsafe-inline'`. Es la regla de
  la sección 9 de `fase-b.md` escrita como prueba, para que no se pierda con el tiempo.
- Permite `fonts.googleapis.com`, `fonts.gstatic.com` y los dos orígenes del mapa.
- `/admin/` y `/api/admin/*` conservan la política estricta (sin `'unsafe-inline'` en estilos).
- Las páginas conservan las demás cabeceras de seguridad: es lo que demuestra que la mezcla
  superficial funcionó y no se perdió nada del registro global.

Mantener el formato de las suites: `check(nombre, condicion, extra)` y el resumen
`N pruebas OK, M fallidas`.

---

## 7. Verificación en el navegador (obligatoria en este paso)

Con caché delante, una política mal puesta deja la página rota guardada una hora. Por eso este
paso no se cierra sin abrir el sitio de verdad:

```bash
STORAGE_DRIVER=json npm run dev      # http://localhost:3000/
```

Recorrer la portada y `contacto.html` (que es la del mapa) y confirmar: tipografías cargadas,
mapa visible, cero violaciones de CSP en la consola. Si quedó elegida la opción B de la sección 2,
los dos avisos esperados son el `onsubmit` y el `onerror`, y ninguno más.

---

## 8. Lo que hereda el paso 7 (nginx)

Hoy nginx ya manda `x-frame-options`, `x-content-type-options` y `referrer-policy` por su cuenta.
Cuando pase a hacer de intermediario hacia Fastify, esas cabeceras van a salir **duplicadas** junto
con las de helmet, con el mismo valor. No rompe nada, pero conviene decidir ahí si se quitan del
lado de nginx para dejar una sola fuente.
