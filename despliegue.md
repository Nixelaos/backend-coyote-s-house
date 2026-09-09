# Plan de despliegue — Coyote's House en Oracle Linux ARM

Continuación de [`plan.md`](plan.md), que dejó la migración a Neon lista y probada sobre la
rama `dev`. Este documento cubre lo que falta para que don Alberto administre el horario
desde Internet.

Fecha: 2026-09-09.

> **Corrección respecto de la primera versión de este plan.** La versión anterior sospechaba
> que Netlify seguía sirviendo `coyoteshouse.cl` y construía la arquitectura sobre esa duda.
> Era falso: **el sitio lo sirve nginx desde la VM**. La evidencia está en la sección 1. Eso
> cambia tres decisiones de fondo —el origen único en vez de un subdominio, el riesgo de las
> reseñas que ya no existe, y la capa de red que ya está probada— y todas están corregidas
> abajo.

---

## 1. Punto de partida

| | Estado |
|---|---|
| Dominio | `coyoteshouse.cl`, DNS en Cloudflare (proxy activo) |
| VM | Oracle Cloud, **ARM**, Oracle Linux, acceso por SSH, con Node y nginx |
| Sitio público | **Servido por nginx desde la VM**, detrás de Cloudflare |
| Reseñas de Google | JSON estático en la VM, refrescado por un script diario propio |
| Backend | Solo corre en tu máquina, en `localhost:3000` |
| Neon | Rama `production` **sin las tablas de la app**; rama `dev` con tablas y datos |
| Repos | `github.com/Nixelaos/coyote-s-house` y `.../backend-coyote-s-house` |

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
`GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `ADMIN_ALLOWED_EMAILS`. `PUBLIC_BASE_URL` se
deduce sola de la URL estable del proyecto, pero conviene fijarla explícitamente una vez que
la conozcas. Después, agregar `https://<backend>.vercel.app/auth/google/callback` a Google
Cloud Console y rellenar el marcador de
[`site-config.js`](../coyote-s-house/js/lib/site-config.js) con la URL del backend.

**Lo que este ensayo NO prueba, y conviene tener claro:**

1. **Las reseñas no se van a ver.** El JSON vive en la VM y Vercel no lo tiene. El componente
   degrada solo a su tarjeta de respaldo y la página queda intacta. Es esperado.
2. **El parpadeo del horario será peor que en producción**, no mejor. Ver la sección 8.2: la
   caché en memoria no sobrevive entre invocaciones de una función, y el límite de
   `@fastify/rate-limit` se multiplica por el número de instancias.
3. **Nada de nginx, SELinux, cortafuegos ni certificados** se ejercita aquí. Esa capa se
   estrena entera en la VM.

`api/index.js`, `vercel.json` y `.vercelignore` no se usan en la VM. Se pueden borrar cuando
el ensayo termine, o dejarlos: no estorban.

---

## 4. Preparación antes de tocar la VM

### 4.1 Subir lo que está sin subir

**Los dos repos tienen un commit local sin empujar**, y en el del backend ese commit es el
adaptador de Neon: o sea, el corazón de todo esto. Si se clona en la VM antes de subirlo,
allá llegaría código sin Neon.

```bash
cd backend-coyote-s-house && git push
cd ../coyote-s-house && git push
```

### 4.2 Resolver el acceso al repo privado

`github.com/Nixelaos/backend-coyote-s-house` responde 404 sin autenticación: es privado. El
`git clone` de la sección 5.1 va a fallar pidiendo credenciales, sin terminal donde
escribirlas. Hay que decidir antes una de tres: una **deploy key** SSH de solo lectura (lo
más limpio; hay que crear `/opt/coyote/.ssh` para el usuario del servicio), un token en la
URL de clonado, o hacer el repo público. Lo mismo aplica al `git pull` de actualización.

### 4.3 Aplicar el esquema a Neon `production`

Es el paso 4.7 que quedó pendiente en `plan.md`. Verificado el 2026-09-09: la rama
`production` (`br-shiny-mouse-acxls5cn`) solo tiene el esquema `neon_auth`; las tablas de la
aplicación no están. El `DATABASE_URL` del `.env` ya apunta a esa rama.

```bash
cd backend-coyote-s-house
npm run db:migrate     # crea las 4 tablas (idempotente)
npm run db:seed        # vuelca data/*.json
```

Ninguno destruye nada: `production` está vacía y ambos se pueden repetir. La semilla se corre
**desde tu máquina**, porque `data/*.json` está en `.gitignore` y no existe en la VM.

### 4.4 Sacar `@neon/config` y `@neon/env` de las dependencias de producción

`package.json` los declara en `dependencies`, pero **nada en `src/`, `test/` ni `migrations/`
los importa** (verificado). Son herramientas del CLI de Neon. Arrastran `@neon/sdk`, `jiti`,
`yargs`, `zod` y un módulo nativo (`@napi-rs/keyring`) que en la VM instalaría el binario ARM
de un llavero que el backend no usa.

```bash
npm uninstall @neon/config @neon/env
npm install --save-dev @neon/config @neon/env
npm test
git commit -am "mover herramientas del CLI de Neon a devDependencies" && git push
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

**Falta un dato que solo tú tienes: el correo de Google de Alberto.** Sin él no se puede
cerrar ni este paso ni el `.env` de la sección 5.2, y sin eso recibe un 403 aunque el login
de Google funcione.

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
ADMIN_ALLOWED_EMAILS=nnicolaslf@gmail.com,correo-de-alberto@gmail.com

STORAGE_DRIVER=neon
DATABASE_URL=<cadena de la rama production>
```

Notas:

- **`NODE_ENV=production` no es decorativo.** Activa la cookie `Secure`, HSTS y `trustProxy`
  en [`server.js:58`](src/server.js#L58). Sin eso el login no funciona sobre HTTPS.
- **Genera un `SESSION_SECRET` nuevo**, distinto del de tu `.env` local, para que seguir
  probando en tu máquina no comparta secreto con producción.
- `ALLOWED_ORIGINS` **no hace falta**: hoy `config.js` la lee pero ningún módulo la consume.
  Con origen único, además, deja de tener sentido.
- Con `STORAGE_DRIVER=neon`, la carpeta `data/` deja de usarse por completo.

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

`ReadWritePaths` incluye `data/` aunque con Neon no se escriba: si algún día vuelves a
`STORAGE_DRIVER=json` para depurar, `ProtectSystem=strict` se lo impediría y el error sería
difícil de leer. La carpeta existe en el clon porque `data/.gitkeep` sí está rastreado — si
no existiera, systemd se negaría a arrancar la unidad.

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

**Revisa si el `server` block ya trae `set_real_ip_from`.** Si no lo tiene, todas las
peticiones llegan con la IP de Cloudflare y el limitador de `@fastify/rate-limit` las mete en
un solo cubo: un abusivo dejaría a todos los demás con 429. Las listas están en
`cloudflare.com/ips-v4` e `ips-v6`, y el cierre es `real_ip_header CF-Connecting-IP;`.

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 5.6 Certificado y cortafuegos: probablemente ya están

Si `https://coyoteshouse.cl` responde hoy desde la VM, entonces **ya funciona** el
certificado hacia Cloudflare, firewalld deja pasar 80/443, y la Security List de la VCN de
Oracle tiene esos puertos abiertos. Toda esa capa está probada y no hay que tocarla.

Vale confirmar una sola cosa en Cloudflare, **SSL/TLS → Overview**: que el modo sea
**Full (strict)**. Con "Flexible" el tramo Cloudflare→VM viaja en claro y, peor, el backend
recibiría `X-Forwarded-Proto: http` y la cookie `Secure` no viajaría.

### 5.7 Cloudflare: las reglas de caché ahora son obligatorias

En **Caching → Cache Rules**, dos reglas en este orden:

| Orden | Expresión | Acción |
|---|---|---|
| 1 | `starts_with(http.request.uri.path, "/api/") or starts_with(http.request.uri.path, "/auth") or starts_with(http.request.uri.path, "/admin")` | **Bypass cache** |
| 2 | `http.request.uri.path eq "/api/public/site-config"` | **Eligible for cache**, respetar TTL del origen |

**La primera dejó de ser prudencia y pasó a ser obligatoria.** Con origen único, las rutas
del backend viven bajo el mismo nombre de host que un sitio estático que Cloudflare cachea
con ganas. Cachear `/auth/*` rompería el parámetro `state` del login, y cachear
`/api/admin/*` podría servirle a alguien la respuesta de la sesión de otro.

La segunda es la que da el CDN: el endpoint público ya emite
`public, max-age=60, stale-while-revalidate=600`, pero Cloudflare **no cachea JSON por
defecto**, así que sin la regla cada visita golpea la VM y despierta Neon.

*Opcional:* una regla de **Rate limiting** sobre `/auth/google` (el plan gratuito permite
una), para que nadie muela el login.

---

## 6. El sitio público

[`site-config.js`](../coyote-s-house/js/lib/site-config.js) ya quedó preparado para los tres
entornos: `localhost` apunta a `:3000`, un host `*.vercel.app` apunta al backend del ensayo,
y **cualquier otro caso devuelve ruta relativa**, que es lo correcto con origen único. En
producción no hay nada más que configurar.

Como el sitio lo sirve la VM, el despliegue es un `git pull` en la carpeta que sirve nginx.

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
   refleja el cambio. En una pestaña ya abierta puede tardar hasta 5 minutos por la caché de
   `sessionStorage`; en incógnito, hasta 60 s por la de Cloudflare.
4. `sudo systemctl restart coyote-backend` → el horario **persiste**. Es la prueba de que la
   migración a Neon sirvió para algo.
5. `sudo systemctl stop coyote-backend` → el sitio sigue en pie con el horario de respaldo,
   sin banner, con el diseño intacto y con las reseñas funcionando (las sirve nginx, no el
   backend).

Comprobar desde tu máquina que la fila quedó escrita, con la cadena de `production`:

```sql
select day_index, open_time, close_time, updated_by from schedule_days order by day_index;
select entity, changed_by, changed_at from audit_log order by id desc limit 5;
```

---

## 8. Riesgos y cosas que quedan fuera

1. **~~Las reseñas de Google.~~** Resuelto antes de este plan: el JSON lo genera un script
   diario en la VM y lo sirve nginx. Ver sección 1.

2. **El horario tarda ~440 ms en aparecer, y eso se nota.** Medido el 2026-09-09 contra la
   rama `dev`: 1.95 s la primera petición con Neon suspendida, y **~440 ms sostenidos** con
   Neon despierta. Durante ese tiempo el visitante ve el horario de respaldo antes de que
   salte al real. Dos causas, las dos arreglables:

   - [`neon-store.js`](src/repositories/neon-store.js) **no cachea nada en memoria**: cada
     visita abre una consulta HTTP a São Paulo. Como el proceso de Node es el único que
     escribe, invalidar una caché al guardar es exacto y trivial. Son unas veinte líneas y
     bajan el endpoint a menos de 1 ms.
   - [`public.routes.js:35-42`](src/routes/public.routes.js#L35-L42) hace las dos consultas
     **en serie**. Un `Promise.all` corta el tiempo a la mitad por sí solo.

   **No se arregla borrando el respaldo del sitio.** Ese respaldo es lo que se ve cuando el
   backend está caído — que es un modo de falla real: nginx y Node son procesos distintos, y
   Neon está en otro país y se suspende sola.

3. **El respaldo del sitio quedará desactualizado.** `CONFIG_POR_DEFECTO` en
   [`site-config.js`](../coyote-s-house/js/lib/site-config.js) está congelado en
   Lun-Vie 09:00-17:00. Cuando Alberto fije su horario definitivo, conviene copiarlo ahí para
   que el día que algo falle el respaldo sea el correcto. Lo mismo con el bloque JSON-LD de
   `index.html`: el JS lo corrige en el navegador, pero un rastreador que no ejecute
   JavaScript lee el valor viejo.

4. **Neon se apaga sola.** En el plan gratuito la base se suspende tras unos minutos sin uso.
   Con la regla 2 de caché el sitio público casi no lo nota; el panel sí, la primera vez que
   Alberto entra en el día. No es un error, pero conviene saberlo antes de salir a depurar
   algo que no está roto.

5. **Latencia.** Neon está en `sa-east-1` (São Paulo). Si la VM de Oracle está en Chile o
   Brasil, son decenas de milisegundos. Si quedó en otro continente, cada carga del panel lo
   va a notar. La caché del punto 2 lo vuelve casi irrelevante.

6. **La API key de Neon del `plan.md`.** Sigue pendiente: `neon mcp -y` acuñó una llave con
   alcance total sobre la cuenta y la escribió en seis archivos de configuración de tu
   equipo. Revocarla con `neon api-keys revoke 3324682` y emitir una acotada al proyecto.

7. **Respaldos.** Neon guarda historial para restauración puntual, pero conviene dejar un
   snapshot explícito antes de cada cambio grande de esquema: `neon snapshot create`.

8. **Actualizar el backend** una vez desplegado:

   ```bash
   cd /opt/coyote/backend
   sudo -u coyote -H git pull
   sudo -u coyote -H npm ci --omit=dev
   sudo systemctl restart coyote-backend
   ```

---

## 9. Orden sugerido

```
4.1 push de los dos repos  -->  4.2 acceso al repo privado
        |
4.3 esquema en Neon production
        |
4.4 limpiar dependencias (+ commit y push)  -->  4.5 Node en la VM
        |
4.6 Google Cloud Console   <-- necesita el correo de Alberto
        |
[opcional]  3. ensayo en Vercel: confirmar que el login funciona sobre HTTPS
        |
5.1 usuario y codigo  -->  5.2 .env  -->  5.3 systemd
        |
        curl http://127.0.0.1:3000/health   desde la VM
        |
5.4 SELinux  -->  5.5 nginx  -->  recargar
        |
        curl https://coyoteshouse.cl/health   desde fuera
        |
5.6 confirmar Full (strict)  -->  5.7 reglas de cache
        |
6. git pull del sitio en la VM
        |
7. verificacion + probar el login de Alberto
```

A diferencia de la versión anterior, el cortafuegos ya no aparece como paso: está resuelto
desde antes. El paso frágil ahora es 5.4, y va **antes** de tocar nginx precisamente para que
un 502 no te haga dudar entre tres causas distintas.
