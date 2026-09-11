# Plan de despliegue — Coyote's House en Oracle Linux ARM

Continuación de [`plan.md`](plan.md), que dejó la migración a Neon lista y probada sobre la
rama `dev`. Este documento cubre lo que falta para que don Alberto administre el horario
desde Internet.

Fecha: 2026-09-09. Revisado contra el sitio en vivo, Neon y los repos: 2026-09-11.

> **Corrección respecto de la primera versión de este plan.** La versión anterior sospechaba
> que Netlify seguía sirviendo `coyoteshouse.cl` y construía la arquitectura sobre esa duda.
> Era falso: **el sitio lo sirve nginx desde la VM**. La evidencia está en la sección 1. Eso
> cambia tres decisiones de fondo —el origen único en vez de un subdominio, el riesgo de las
> reseñas que ya no existe, y la capa de red que ya está probada— y todas están corregidas
> abajo.

> **Segunda corrección (2026-09-11).** Se verificó el estado real con `curl` al sitio vivo, el
> MCP de Neon y el estado de los repos. Tres cosas cambian este plan:
>
> 1. **El backend no está desplegado en absoluto.** `/health`, `/admin/` y `/api/*` devuelven
>    el 404 HTML de nginx: no existe ningún `location` hacia Fastify. Nada de la sección 5
>    está hecho.
> 2. **El clon del sitio en la VM está dos commits atrás** (en `8a5f346`, del 26/08). Los
>    commits del 09/09 que agregan `site-config.js` y el banner no están en producción.
> 3. **Se decidió cambiar la arquitectura del horario y el anuncio**: el hardcode del sitio
>    desaparece, el HTML lo renderiza el backend desde un espejo JSON en disco, nginx guarda
>    `proxy_cache` y Cloudflare cachea el HTML con purga al guardar. Las secciones que ese
>    cambio deja obsoletas están marcadas con **⚠️ OBSOLETO** y se reescriben en la fase B
>    (sección 9).

---

## 1. Punto de partida

| | Estado |
|---|---|
| Dominio | `coyoteshouse.cl`, DNS en Cloudflare (proxy activo) |
| VM | Oracle Cloud, **ARM**, Oracle Linux, acceso por SSH, con Node y nginx |
| Sitio público | **Servido por nginx desde la VM**, detrás de Cloudflare. El clon está en `8a5f346` (26/08), **dos commits atrás** de `origin/main` |
| Reseñas de Google | JSON estático en la VM, refrescado por un script diario propio. Verificado 11/09: 200, 3254 bytes |
| Backend | Solo corre en tu máquina, en `localhost:3000`. **En la VM no hay nada**: ni usuario, ni clon, ni env, ni unidad |
| Neon | Rama `production` (`br-shiny-mouse-acxls5cn`) **con las 4 tablas y la semilla desde el 11/09** (7 días, banner apagado); rama `dev` (`br-raspy-leaf-acxjfpas`) también. Región `aws-sa-east-1`, PG 18, PITR de 6 h |
| Cloudflare | SSL/TLS en modo **Full** (no strict). El HTML sale `cf-cache-status: DYNAMIC`; el CSS con `max-age=14400` |
| nginx | **Sin** `set_real_ip_from`: las peticiones llegan con la IP de Cloudflare |
| Google Cloud Console | Solo `http://localhost:3000/auth/google/callback`. Falta la URI de producción y el correo de Alberto |
| Repos | `github.com/Nixelaos/coyote-s-house` (público) y `.../backend-coyote-s-house` (**privado**). Ambos al día con `origin/main` |

### Cómo se confirmó que el origen es la VM

Vale dejarlo escrito, porque el prefijo `/.netlify/` en la ruta de las reseñas induce a
pensar lo contrario:

- `curl -I https://coyoteshouse.cl/.netlify/functions/google-reviews` devuelve
  `etag: "6aa0a886-cb6"`. `0xcb6` son 3254 bytes, exactamente el `Content-Length`. Ese
  formato *hex(mtime)-hex(tamaño)* es el algoritmo de ETag de **nginx** sirviendo un archivo
  del disco; una función serverless no lo produce.
- La misma respuesta trae `Accept-Ranges: bytes`, propio de un archivo estático.
- `last-modified` corresponde a la ejecución del script diario de la madrugada.
- Una ruta inventada bajo `/.netlify/functions/` devuelve **403** (nginx negando un
  directorio sin índice), no el 404 que daría Netlify.

La ruta conserva el prefijo heredado a propósito: así el JavaScript del sitio no necesitó
cambiar durante la migración. **Las reseñas ya no son un riesgo de este despliegue.**

---

## 2. Arquitectura objetivo

```
                    Cloudflare  (proxy naranja: CDN, TLS, WAF)
                                      |
                             coyoteshouse.cl
                                      |
                              nginx :443 (VM)
                    +-----------------+-----------------+
                    |                                   |
            archivos estaticos                  proxy_pass a
            del sitio + resenas               127.0.0.1:3000
            (como hoy)                                |
                                                Fastify (systemd)
                                                      |
                                              Neon - production
                                              sa-east-1 (Sao Paulo)
```

> **⚠️ Cambia en la fase B.** En el diseño acordado el 11/09, nginx también manda `/` y
> `*.html` a Fastify (que renderiza el horario y el banner dentro del HTML), guarda una copia en
> `proxy_cache` para seguir sirviéndola si Fastify cae, y Fastify lee el horario de un espejo
> `data/*.json` que se escribe al guardar desde el panel. Neon queda solo en el camino de
> escritura. El diagrama de arriba sigue valiendo tal cual para `/api`, `/auth` y `/admin`.

### Origen único, no subdominio

La versión anterior de este plan proponía `api.coyoteshouse.cl` **solo porque no sabía dónde
vivía el sitio**, y dejaba dicho que si resultaba estar en la VM convenía un único origen.
Eso es lo que pasó, así que:

- Nada de registro DNS nuevo, nada de certificado nuevo: se reutiliza el `server` block que
  ya sirve `coyoteshouse.cl` por HTTPS y funciona.
- **Sin CORS.** El sitio pide `/api/public/site-config` como ruta relativa, del mismo origen.
- El panel queda en `coyoteshouse.cl/admin/`, que para Alberto es una URL que reconoce.
- Menos piezas nuevas que estrenar es menos superficie donde equivocarse, y ese es el
  criterio que ordena todo este plan.

---

## 3. Ensayo en Vercel (opcional, recomendado antes de la VM)

Desplegar primero en Vercel separa dos fuentes de falla que de otro modo se depuran juntas:
**¿funciona la aplicación en condiciones reales** (HTTPS, cookie `Secure`, login de Google,
Neon)**?** y **¿está bien configurada la VM?**. Si el login funciona en Vercel, cualquier
problema posterior en la VM es de infraestructura, y eso es la mitad del trabajo de depurar.

El repo ya está preparado: [`api/index.js`](api/index.js) adapta el servidor a la función de
Vercel y [`vercel.json`](vercel.json) manda todas las rutas ahí. Probado en local contra el
adaptador real: `/health` 200, `/api/public/site-config` 200, `/admin/` 200,
`/api/admin/schedule` 401.

**Pasos.** Crear dos proyectos en Vercel, uno por repo. En el del backend, definir las
variables: `STORAGE_DRIVER=neon`, `DATABASE_URL` (rama `production`), `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `ADMIN_ALLOWED_EMAILS`, y **`DATA_DIR=/tmp/coyote-data`**:
desde la fase B el driver `neon` escribe un espejo JSON en disco en cada guardado, y en Vercel
el único directorio escribible es `/tmp`. Como `/tmp` no sobrevive entre instancias, cada
arranque en frío rehidrata el espejo desde Neon — funciona, solo más lento que en la VM. `PUBLIC_BASE_URL` se
deduce sola de la URL estable del proyecto, pero conviene fijarla explícitamente una vez que
la conozcas. Después, agregar `https://<backend>.vercel.app/auth/google/callback` a Google
Cloud Console y rellenar el marcador de
[`site-config.js`](../coyote-s-house/js/lib/site-config.js) con la URL del backend.

**Lo que este ensayo NO prueba, y conviene tener claro:**

1. **Las reseñas no se van a ver.** El JSON vive en la VM y Vercel no lo tiene. El componente
   degrada solo a su tarjeta de respaldo y la página queda intacta. Es esperado.
2. ~~**El parpadeo del horario será peor que en producción**, no mejor.~~ **⚠️ Cambia en la
   fase B:** el parpadeo desaparece del diseño (el horario viaja dentro del HTML), así que este
   ensayo ya no lo mide. Lo que sí sigue siendo cierto: el límite de `@fastify/rate-limit` se
   multiplica por el número de instancias, y **`proxy_cache` de nginx no existe en Vercel** —
   la resiliencia a una caída de Fastify solo se prueba en la VM. El ensayo queda para una
   sola cosa: confirmar el login de Google sobre HTTPS real.
3. **Nada de nginx, SELinux, cortafuegos ni certificados** se ejercita aquí. Esa capa se
   estrena entera en la VM.

`api/index.js`, `vercel.json` y `.vercelignore` no se usan en la VM. Se pueden borrar cuando
el ensayo termine, o dejarlos: no estorban.

---

## 4. Preparación antes de tocar la VM

### 4.1 Subir lo que está sin subir — ✅ hecho

Verificado el 11/09: los dos repos están al día con `origin/main`. Lo único sin commit es el
movimiento de las pruebas a `../tests-backend-coyote-s-house/` y el paso 4.4, que van juntos en
el próximo commit.

### 4.2 Resolver el acceso al repo privado — decidido: deploy key

`github.com/Nixelaos/backend-coyote-s-house` responde 404 sin autenticación: es privado
(verificado 11/09; el del sitio es público). Se resuelve con una **deploy key** SSH de solo
lectura, propia del usuario `coyote`. Es la opción más limpia: no hay token que caduque ni que
quede escrito en una URL dentro de `.git/config`, y si la VM se compromete se revoca esa llave
sola, sin tocar tu cuenta.

Como la llave pertenece al usuario del servicio, **estos comandos van justo después del
`useradd` de 5.1 y antes del `git clone`**:

```bash
# 1. Llave para el usuario coyote (sin passphrase: la usa un proceso, no una persona)
sudo mkdir -p /opt/coyote/.ssh
sudo ssh-keygen -t ed25519 -N "" -C "deploy coyote-backend" -f /opt/coyote/.ssh/id_ed25519
sudo chown -R coyote:coyote /opt/coyote/.ssh
sudo chmod 700 /opt/coyote/.ssh
sudo chmod 600 /opt/coyote/.ssh/id_ed25519

# 2. Esto es lo que se pega en GitHub
sudo cat /opt/coyote/.ssh/id_ed25519.pub
```

En GitHub: **repo `backend-coyote-s-house` → Settings → Deploy keys → Add deploy key**. Título
`VM Oracle coyote`, pegar la llave pública, y dejar **"Allow write access" sin marcar**: la VM
solo clona y hace `pull`.

```bash
# 3. Registrar la huella de GitHub para que el primer clone no pida confirmación
ssh-keyscan -t ed25519 github.com | sudo -u coyote tee -a /opt/coyote/.ssh/known_hosts

# 4. Probar antes de clonar. Debe responder:
#    "Hi Nixelaos/backend-coyote-s-house! You've successfully authenticated, but GitHub
#     does not provide shell access."
sudo -u coyote -H ssh -T git@github.com
```

Conviene comparar la huella que devuelve `ssh-keyscan` con las que GitHub publica en la página
«GitHub's SSH key fingerprints» de docs.github.com antes de confiar en ella.

La URL de clonado de 5.1 queda `git@github.com:Nixelaos/backend-coyote-s-house.git`, y el
`git pull` de actualización (8.8) usa la misma llave sin configurar nada más, porque `-H` deja
`HOME=/opt/coyote` y ssh la encuentra en su ruta por defecto.

### 4.3 Aplicar el esquema a Neon `production` — ✅ hecho

Es el paso 4.7 que quedó pendiente en `plan.md`. **Aplicado el 11/09** con los dos comandos de
abajo, contra el `DATABASE_URL` del `.env` (endpoint `ep-bold-dawn-ac7xgnqy`, rama
`production`). Verificado por MCP sobre `br-shiny-mouse-acxls5cn`: las 4 tablas existen,
`schedule_days` tiene 7 filas (Lun–Vie 09:00–17:00, Sáb y Dom cerrados), `banners` 1 fila
(apagado), `schedule_exceptions` 0 y `audit_log` 2 — idéntico a lo que el sitio muestra hoy.
`updated_by` quedó en `desconocido` porque el JSON nunca se editó desde el panel.

```bash
cd backend-coyote-s-house
npm run db:migrate     # crea las 4 tablas (idempotente)
npm run db:seed        # vuelca data/*.json
```

Ninguno destruye nada: `production` está vacía y ambos se pueden repetir. La semilla se corre
**desde tu máquina**, porque `data/*.json` está en `.gitignore` y no existe en la VM.

Con el espejo de la fase B, en la VM esos archivos los genera el propio backend al arrancar,
hidratándolos desde Neon: no hay que copiarlos a mano.

### 4.4 Sacar `@neon/config` y `@neon/env` de las dependencias de producción — ✅ hecho

`package.json` los declaraba en `dependencies`, pero **nada en `src/`, `migrations/` ni `api/`
los importa** (verificado de nuevo el 11/09 con una guarda antes de desinstalar). Son
herramientas del CLI de Neon. Arrastran `@neon/sdk`, `jiti`, `yargs`, `zod` y un módulo nativo
(`@napi-rs/keyring`) que en la VM instalaría el binario ARM de un llavero que el backend no
usa.

Aplicado el 11/09: ahora viven en `devDependencies` (`@neon/config ^1.4.0`, `@neon/env ^1.3.0`
— npm los subió de versión al reinstalarlos; son herramientas de desarrollo y las pruebas
pasan igual). Queda:

```bash
git add -A
git commit -m "mover tests a ../tests-backend-coyote-s-house y @neon/* a devDependencies"
git push
```

**El commit y el push no son opcionales:** sin ellos, el `npm ci --omit=dev` de la VM
instalaría igual lo que este paso buscaba evitar.

### 4.5 Confirmar Node en la VM

```bash
node -v            # tiene que ser >= 20.11.0 (lo declara package.json)
command -v node    # tiene que coincidir con el ExecStart del servicio
```

Si es menor, instalar Node 22 LTS para ARM64. Si la ruta no es `/usr/bin/node` —porque venga
de nvm o de un tarball— hay que ajustar `ExecStart`, o el servicio no arranca.

### 4.6 Google Cloud Console

Dos cosas, en *APIs y servicios*:

1. **Credenciales → tu ID de cliente OAuth**, agregar:
   - URI de redireccionamiento autorizado: `https://coyoteshouse.cl/auth/google/callback`
   - Origen JavaScript autorizado: `https://coyoteshouse.cl`

   No borres `http://localhost:3000/auth/google/callback`: sirve para seguir probando local.
   Si haces el ensayo de la sección 3, agrega también las de Vercel.

2. **Pantalla de consentimiento.** Si el proyecto está en *Testing*, solo entran los correos
   listados como usuarios de prueba. Agrega ahí el de don Alberto, o publica la aplicación.
   Publicarla **no requiere verificación de Google** en este caso, porque los únicos permisos
   que pide son `openid`, `email` y `profile`, que no son sensibles.

Verificado el 11/09: en Google Console solo existe la URI de `localhost`, y
`ADMIN_ALLOWED_EMAILS` del `.env` local tiene un solo correo. Este es el único paso que
**bloquea el login** aunque todo lo demás funcione.

**Decisión del 11/09: por ahora la allowlist lleva solo `nnicolaslf@gmail.com`.** El correo de
Alberto se agrega cuando lo tengas, sin redesplegar: es una línea más en
`/etc/coyote/backend.env` y un `systemctl restart coyote-backend`. Hasta entonces, si Alberto
intenta entrar recibe un 403 aunque el login de Google funcione — es lo esperado. Lo que sí
sigue bloqueando el login es la **URI de redireccionamiento de producción** en Google Console
(punto 1 de arriba).

---

## 5. La VM

### 5.1 Usuario propio y código

El backend no debe correr como `root` ni como tu usuario de SSH.

```bash
sudo useradd --system --home /opt/coyote --shell /sbin/nologin coyote
sudo mkdir -p /opt/coyote
sudo chown coyote:coyote /opt/coyote

sudo -u coyote -H git clone <url-segun-4.2> /opt/coyote/backend
cd /opt/coyote/backend
sudo -u coyote -H npm ci --omit=dev
```

**El `-H` importa.** Sin él, `sudo -u` puede dejar `HOME` apuntando al home de quien invoca
(o a `/root`), y npm falla al escribir su caché con un `EACCES` que no explica nada.

Va en `/opt` y no bajo la raíz de nginx a propósito: `/var/www` es para documentos que nginx
entrega, y ahí el código fuente quedaría expuesto a quien lo pidiera por URL.

### 5.2 Variables de entorno

Fuera del repo, con permisos cerrados: contiene el secreto de Google, el de sesión y la
cadena de Postgres.

```bash
sudo mkdir -p /etc/coyote
sudo install -o root -g coyote -m 0640 /dev/null /etc/coyote/backend.env
sudo vi /etc/coyote/backend.env
```

Contenido:

```ini
NODE_ENV=production
PORT=3000
# Solo loopback: nginx es el único que habla con el backend. Con 0.0.0.0
# quedaría escuchando en la IP pública y accesible saltándose Cloudflare.
HOST=127.0.0.1

PUBLIC_BASE_URL=https://coyoteshouse.cl

GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
SESSION_SECRET=...
# Por ahora solo tú; el correo de Alberto se agrega después (ver 4.6).
ADMIN_ALLOWED_EMAILS=nnicolaslf@gmail.com

STORAGE_DRIVER=neon
DATABASE_URL=<cadena de la rama production>

# Carpeta que hoy sirve nginx (los .html del sitio). Averiguarla en la VM con:
#   grep -rn "root " /etc/nginx/
SITE_ROOT=<docroot de nginx>
```

Notas:

- **`SITE_ROOT` (fase B, paso 2).** Sin ella Fastify busca `../coyote-s-house` junto al repo del
  backend, que en la VM no existe, y las páginas darían 404. Si la variable apunta a una carpeta
  inexistente el servicio **no arranca**, a propósito: un typo aquí se nota en el primer
  `systemctl status`. El usuario `coyote` necesita permiso de lectura sobre esa carpeta (con
  `ProtectSystem=strict` leer está permitido; escribir no, y no hace falta).

- **`NODE_ENV=production` no es decorativo.** Activa la cookie `Secure`, HSTS y `trustProxy`
  en [`server.js:58`](src/server.js#L58). Sin eso el login no funciona sobre HTTPS.
- **Genera un `SESSION_SECRET` nuevo**, distinto del de tu `.env` local, para que seguir
  probando en tu máquina no comparta secreto con producción.
- `ALLOWED_ORIGINS` **no hace falta**: hoy `config.js` la lee pero ningún módulo la consume.
  Con origen único, además, deja de tener sentido.
- ~~Con `STORAGE_DRIVER=neon`, la carpeta `data/` deja de usarse por completo.~~
  **⚠️ OBSOLETO (11/09):** con el espejo de la fase B, `data/*.json` **vuelve a escribirse** en
  cada guardado y es lo que lee el render público. Neon queda como fuente de verdad y respaldo.

### 5.3 Servicio de systemd

`/etc/systemd/system/coyote-backend.service`:

```ini
[Unit]
Description=Backend de Coyote's House
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=coyote
Group=coyote
WorkingDirectory=/opt/coyote/backend
EnvironmentFile=/etc/coyote/backend.env
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=5

# El proceso solo necesita leer su propio código.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/coyote/backend/data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now coyote-backend
systemctl status coyote-backend
curl -s http://127.0.0.1:3000/health
journalctl -u coyote-backend -f
```

`ReadWritePaths` incluye `data/` y **ahora es imprescindible**, no una precaución: el espejo
JSON de la fase B se escribe ahí en cada guardado, y `ProtectSystem=strict` lo bloquearía con
un `EROFS` difícil de leer. La carpeta existe en el clon porque `data/.gitkeep` sí está
rastreado — si no existiera, systemd se negaría a arrancar la unidad.

### 5.4 SELinux — ahora es el tropiezo más probable de todo el plan

Con SELinux en *enforcing*, nginx **no puede** conectarse a un puerto local. El proxy
devuelve 502 y el log dice `Permission denied` sin más explicación:

```bash
sudo setsebool -P httpd_can_network_connect 1
```

**Por qué subió de importancia:** nginx sirviendo archivos estáticos convive con SELinux sin
problemas, y por eso tu sitio funciona hoy sin haber tocado nada de esto. `proxy_pass` es la
única capacidad de red nueva que vas a estrenar, y es exactamente la que SELinux bloquea por
defecto. Si algo falla en este despliegue, empieza por aquí.

### 5.5 nginx

No hay `server` block nuevo: se agregan localizaciones al que ya sirve `coyoteshouse.cl`.

Primero, el bloque de proxy en un archivo aparte para no repetirlo cuatro veces —
`/etc/nginx/conf.d/coyote-backend.inc`:

```nginx
proxy_pass http://127.0.0.1:3000;
proxy_http_version 1.1;
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto https;
proxy_read_timeout 30s;
```

Y dentro del `server { listen 443 ... server_name coyoteshouse.cl; }` que ya existe:

```nginx
    # El backend limita el cuerpo a 64 KB; nginx corta antes.
    client_max_body_size 128k;

    location /api/     { include /etc/nginx/conf.d/coyote-backend.inc; }
    location /auth/    { include /etc/nginx/conf.d/coyote-backend.inc; }
    location /admin/   { include /etc/nginx/conf.d/coyote-backend.inc; }
    location = /health { include /etc/nginx/conf.d/coyote-backend.inc; }
    location = /admin  { return 301 /admin/; }
```

**Confirmado el 11/09: el `server` block NO trae `set_real_ip_from`.** Hoy no importa porque
nginx solo sirve archivos, pero en cuanto haya `proxy_pass` todas las peticiones llegan a
Fastify con la IP de Cloudflare y el limitador de `@fastify/rate-limit` las mete en un solo
cubo: un abusivo dejaría a todos los demás con 429.

En vez de copiar los rangos a mano (cambian, y un error de tipeo es invisible), se genera el
archivo desde las listas oficiales:

```bash
{ curl -fsS https://www.cloudflare.com/ips-v4; echo; curl -fsS https://www.cloudflare.com/ips-v6; echo; } \
  | grep -v '^$' | sed 's/^/set_real_ip_from /; s/$/;/' \
  | sudo tee /etc/nginx/conf.d/cloudflare-real-ip.inc >/dev/null
echo 'real_ip_header CF-Connecting-IP;' | sudo tee -a /etc/nginx/conf.d/cloudflare-real-ip.inc >/dev/null
cat /etc/nginx/conf.d/cloudflare-real-ip.inc   # ~22 líneas, ninguna vacía
```

Y dentro del `server` block, **antes** de los `location` del backend:

```nginx
    include /etc/nginx/conf.d/cloudflare-real-ip.inc;
```

Se comprueba en `journalctl -u coyote-backend`: si las peticiones muestran IPs `104.x`,
`172.6x` o `162.15x`, el bloque no está surtiendo efecto. Repetir el generador una vez al año.

> **⚠️ Se amplía en la fase B.** Los cuatro `location` de arriba cubren el panel y la API. Con
> el diseño nuevo se suman `location = /` y `location ~ \.html$` hacia el backend, más
> `proxy_cache_path` y `proxy_cache_use_stale` para que nginx siga sirviendo la última página
> buena si Fastify cae. Ese bloque se escribe cuando el render en servidor exista.

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 5.6 Certificado y cortafuegos: probablemente ya están

Si `https://coyoteshouse.cl` responde hoy desde la VM, entonces **ya funciona** el
certificado hacia Cloudflare, firewalld deja pasar 80/443, y la Security List de la VCN de
Oracle tiene esos puertos abiertos. Toda esa capa está probada y no hay que tocarla.

Confirmado el 11/09 en **SSL/TLS → Overview**: el modo es **Full**, no *Full (strict)*.
**No bloquea el despliegue**: el tramo Cloudflare→VM va cifrado, y la cookie `Secure` viaja
igual porque el `.inc` de 5.5 fuerza `X-Forwarded-Proto https` sin depender de lo que mande
Cloudflare. Lo que "Full" no hace es validar el certificado de la VM. Subir a *strict* es
endurecimiento opcional para el final, y depende de qué certificado tiene nginx: si es un
**Origin CA** de Cloudflare o uno de Let's Encrypt, *strict* funciona sin más; si es
autofirmado, *strict* rompe el sitio entero hasta cambiarlo. Con "Flexible" sí habría problema
(el tramo iría en claro), pero no es el caso.

### 5.7 Cloudflare: las reglas de caché ahora son obligatorias

En **Caching → Cache Rules**, dos reglas en este orden:

| Orden | Expresión | Acción |
|---|---|---|
| 1 | `starts_with(http.request.uri.path, "/api/") or starts_with(http.request.uri.path, "/auth") or starts_with(http.request.uri.path, "/admin")` | **Bypass cache** |
| 2 | ~~`http.request.uri.path eq "/api/public/site-config"`~~ | ~~**Eligible for cache**~~ **⚠️ OBSOLETO** — ver abajo |

**La primera dejó de ser prudencia y pasó a ser obligatoria.** Con origen único, las rutas
del backend viven bajo el mismo nombre de host que un sitio estático que Cloudflare cachea
con ganas. Cachear `/auth/*` rompería el parámetro `state` del login, y cachear
`/api/admin/*` podría servirle a alguien la respuesta de la sesión de otro.

~~La segunda es la que da el CDN: el endpoint público ya emite
`public, max-age=60, stale-while-revalidate=600`, pero Cloudflare **no cachea JSON por
defecto**, así que sin la regla cada visita golpea la VM y despierta Neon.~~

**⚠️ OBSOLETO (11/09).** El sitio ya no va a pedir `/api/public/site-config`: el horario y el
banner llegan dentro del HTML. La regla 2 se reemplaza en la fase B por una que haga
**elegible para caché el HTML de las páginas públicas** (Cloudflare no cachea HTML por
defecto; verificado: `/` sale `cf-cache-status: DYNAMIC`), con un **TTL finito** —una hora o
un día, nunca un año— y una **purga por URL** que dispara el backend al guardar desde el
panel. El TTL finito es la red de seguridad: si la purga falla, el cambio aparece solo cuando
vence, en vez de quedar pegado para siempre.

Dos consecuencias que la regla 1 debe absorber antes de encender la 2:

- El panel estático (`/admin/index.html`, `admin.js`) hoy sale con `Cache-Control: no-cache`
  ([`server.js:88`](src/server.js#L88)), que significa "revalida", no "no guardes". Pasa a
  `private, no-store` en la fase B. La API de `/api/admin/*` ya usa `no-store`.
- Con `trustProxy` y sin `real_ip` (5.5), el rate-limit no puede distinguir visitantes. Va
  primero.

*Opcional:* una regla de **Rate limiting** sobre `/auth/google` (el plan gratuito permite
una), para que nadie muela el login.

---

## 6. El sitio público

[`site-config.js`](../coyote-s-house/js/lib/site-config.js) ya quedó preparado para los tres
entornos: `localhost` apunta a `:3000`, un host `*.vercel.app` apunta al backend del ensayo,
y **cualquier otro caso devuelve ruta relativa**, que es lo correcto con origen único. En
producción no hay nada más que configurar.

Como el sitio lo sirve la VM, el despliegue es un `git pull` en la carpeta que sirve nginx.

**Verificado el 11/09: ese `pull` no se ha hecho.** El clon está en `8a5f346` (26/08) y
`js/lib/site-config.js` devuelve 404 en vivo. **No hacerlo todavía**: desplegaría un
`site-config.js` cuyo `fetch` a `/api/public/site-config` da 404 (el backend no existe), y que
además la fase B reescribe —se le quita el `fetch`, el `sessionStorage` y
`CONFIG_POR_DEFECTO`—. El `pull` se hace **una sola vez**, con la versión final, en la fase C.

Ese mismo commit borra lo que quedaba de Netlify: `netlify.toml`, las dos funciones, la
dependencia `@netlify/blobs` y una función muerta en `main.js` que eliminaba cualquier
`iframe` cuya URL contuviera "badge". El JSON de reseñas que sirve nginx no se toca: vive en
`.netlify/`, que está en `.gitignore` y por lo tanto git no lo rastrea ni lo pisa.

---

## 7. Verificación

Desde fuera de la VM:

```bash
curl -s https://coyoteshouse.cl/health
curl -s https://coyoteshouse.cl/api/public/site-config | head -c 200
curl -sI https://coyoteshouse.cl/api/admin/schedule | head -3   # debe ser 401
curl -sI https://coyoteshouse.cl/.netlify/functions/google-reviews | head -3   # sigue 200
```

Desde la VM, que la IP real esté llegando (si el log muestra la IP de Cloudflare, falta
`real_ip`):

```bash
journalctl -u coyote-backend -n 20
```

Y a mano:

1. Entrar a `https://coyoteshouse.cl/admin/`, iniciar sesión con Google.
2. Cambiar el horario y guardar.
3. Recargar `https://coyoteshouse.cl` **en una ventana de incógnito** → la barra de horario
   refleja el cambio. ~~En una pestaña ya abierta puede tardar hasta 5 minutos por la caché de
   `sessionStorage`; en incógnito, hasta 60 s por la de Cloudflare.~~ **⚠️ Cambia en la
   fase B:** debe verse **de inmediato**, porque el guardado purga Cloudflare. Si tarda, la
   purga falló y el panel tiene que haberlo avisado.
4. `sudo systemctl restart coyote-backend` → el horario **persiste**. Es la prueba de que la
   migración a Neon sirvió para algo.
5. `sudo systemctl stop coyote-backend` → ~~el sitio sigue en pie con el horario de respaldo,
   sin banner, con el diseño intacto~~ **⚠️ Cambia en la fase B:** el sitio sigue en pie **con
   el último horario y banner reales**, servidos por nginx desde `proxy_cache`, y con las
   reseñas funcionando (las sirve nginx, no el backend). Si en vez de eso aparece un 502, falta
   `proxy_cache_use_stale`.

Comprobar desde tu máquina que la fila quedó escrita, con la cadena de `production`:

```sql
select day_index, open_time, close_time, updated_by from schedule_days order by day_index;
select entity, changed_by, changed_at from audit_log order by id desc limit 5;
```

---

## 8. Riesgos y cosas que quedan fuera

1. **~~Las reseñas de Google.~~** Resuelto antes de este plan: el JSON lo genera un script
   diario en la VM y lo sirve nginx. Ver sección 1.

2. ~~**El horario tarda ~440 ms en aparecer, y eso se nota.**~~ **⚠️ OBSOLETO (11/09).** La
   medición sigue siendo cierta (1.95 s con Neon suspendida, ~440 ms con Neon despierta, contra
   São Paulo), pero la solución cambió: en vez de cachear en memoria dentro de
   `neon-store.js`, el render público **lee de un espejo `data/*.json` en disco** que el
   backend escribe al guardar. Neon sale del camino de lectura por completo, y con él la
   latencia, el arranque en frío y el `Promise.all`. Y al contrario de lo que decía este punto,
   **el respaldo del sitio sí se borra** — ver el siguiente.

   Lo que sigue siendo verdad es la premisa: nginx y Node son procesos distintos, y el que se
   cae es Node — no por carga ni memoria (con 12 GB usa ~80 MB), sino **el día que se toca**:
   un typo en `backend.env` hace que `validateConfig()` salga con 1 y `Restart=always` entre en
   bucle cada 5 s sin rendirse nunca. Por eso la red de seguridad es `proxy_cache` de nginx, no
   un hardcode.

3. ~~**El respaldo del sitio quedará desactualizado.**~~ **⚠️ OBSOLETO (11/09).**
   `CONFIG_POR_DEFECTO` **se elimina** en la fase B, no se mantiene. Razón: es la única capa
   que puede mostrar información *incorrecta con confianza* (un "Abierto hasta 17:00" en plenas
   vacaciones). Las capas que lo reemplazan —`proxy_cache` de nginx si Fastify cae, caché de
   Cloudflare si la VM entera cae— sirven el **último dato real**. El JSON-LD de `index.html`
   también deja de estar hardcodeado: lo renderiza el backend con el horario vigente, así que
   un rastreador sin JavaScript lee el valor correcto.

4. **Neon se apaga sola.** En el plan gratuito la base se suspende tras unos minutos sin uso.
   Con la regla 2 de caché el sitio público casi no lo nota; el panel sí, la primera vez que
   Alberto entra en el día. No es un error, pero conviene saberlo antes de salir a depurar
   algo que no está roto.

5. **Latencia.** Neon está en `sa-east-1` (São Paulo). Si la VM de Oracle está en Chile o
   Brasil, son decenas de milisegundos. Si quedó en otro continente, cada carga del panel lo
   va a notar. Con el espejo en disco de la fase B, esa latencia la paga **solo el panel al
   guardar**, nunca un visitante del sitio.

6. **La API key de Neon del `plan.md`.** Sigue pendiente: `neon mcp -y` acuñó una llave con
   alcance total sobre la cuenta y la escribió en seis archivos de configuración de tu
   equipo. Revocarla con `neon api-keys revoke 3324682` y emitir una acotada al proyecto.

7. **Respaldos.** Neon guarda historial para restauración puntual, pero **solo 6 horas**
   (`history_retention_seconds: 21600`, verificado 11/09): un guardado malo un viernes no se
   recupera el lunes. Conviene dejar un snapshot explícito antes de cada cambio grande de
   esquema (`neon snapshot create`) y, con el espejo de la fase B, considerar versionar
   `data/*.json` en algún lado como respaldo de más profundidad.

8. **Actualizar el backend** una vez desplegado:

   ```bash
   cd /opt/coyote/backend
   sudo -u coyote -H git pull
   sudo -u coyote -H npm ci --omit=dev
   sudo systemctl restart coyote-backend
   ```

---

## 9. Orden sugerido (revisado 11/09)

Como no hay nada del backend en producción, no hay migración en caliente que cuidar: la VM se
toca **una sola vez**, con el diseño final. Tres fases.

```
A. Preparacion, desde tu maquina, independiente del diseño
   4.1 push                                 [hecho]
   4.4 @neon/* a devDependencies            [hecho]  -->  commit junto al movimiento de tests
   4.3 db:migrate + db:seed en production   [hecho 11/09, verificado por MCP]
   4.6 URI de produccion en Google Console  [pendiente: bloquea el login; allowlist solo tu correo por ahora]
           |
B. Cambios de diseño (decision del 11/09)
   espejo JSON: guardar en Neon --> escribir data/*.json; el render lee del disco   [hecho 11/09]
   render en servidor: banner, resumen, JSON-LD y datos dentro del HTML de las 9 paginas
   site-config.js: quitar fetch, sessionStorage y CONFIG_POR_DEFECTO
   fallar con 5xx si el espejo no se puede leer (no envenenar la cache)
   /admin estatico --> private, no-store
   purga de Cloudflare al guardar (best-effort, TTL finito, aviso en el panel)
   reescribir 5.5 (proxy_cache) y 5.7 (cachear HTML) de este documento
   npm test
           |
[opcional]  3. ensayo en Vercel: confirmar que el login funciona sobre HTTPS
           |
C. La VM, una sola vez
   5.1 usuario  -->  4.2 deploy key  -->  clone  -->  npm ci --omit=dev
   5.2 .env  -->  5.3 systemd
           curl http://127.0.0.1:3000/health   desde la VM
   5.4 SELinux
   5.5 nginx: real_ip  -->  proxy  -->  proxy_cache  -->  nginx -t  -->  reload
           curl https://coyoteshouse.cl/health   desde fuera
   5.7 Cache Rules: bypass admin/auth/api, despues cachear HTML
   6.  git pull del sitio en la VM
   7.  verificacion + login de Alberto
   5.6 [opcional] subir Cloudflare a Full (strict) si el certificado lo permite
```

El paso frágil sigue siendo 5.4, y sigue yendo **antes** de tocar nginx para que un 502 no te
haga dudar entre tres causas. Lo que cambió de orden: 4.2 se movió dentro de C porque la deploy
key pertenece al usuario `coyote`, que se crea en 5.1; y 6 pasó al final porque el sitio actual
en la VM no debe recibir un `site-config.js` que va a ser reescrito.
