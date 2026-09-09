# Plan de despliegue — Coyote's House en Oracle Linux ARM

Continuación de [`plan.md`](plan.md), que dejó la migración a Neon lista y probada sobre la
rama `dev`. Este documento cubre lo que falta para que don Alberto administre el horario
desde Internet.

Fecha: 2026-09-09.

---

## 1. Punto de partida

Lo confirmado sobre la infraestructura:

| | Estado |
|---|---|
| Dominio | `coyoteshouse.cl`, DNS en Cloudflare |
| VM | Oracle Cloud, **ARM**, Oracle Linux, acceso por SSH, con Node y nginx |
| Sitio público | Sirviéndose hoy a través de Cloudflare (ver el aviso más abajo) |
| Backend | Solo corre en tu máquina, en `localhost:3000` |
| Neon | Rama `production` **sin tablas**; rama `dev` con tablas y datos |
| Repos | `github.com/Nixelaos/coyote-s-house` y `.../backend-coyote-s-house` |

### Aviso: hay que confirmar dónde termina hoy `coyoteshouse.cl`

Dijiste que el HTML ya está en la VM con nginx, pero al consultar el sitio en vivo encontré
señales de que **Netlify sigue sirviendo el origen**:

- `https://coyoteshouse.cl/.netlify/functions/google-reviews` devuelve JSON real, con
  reseñas y `updatedAt` del 2026-09-09. Esa función usa `@netlify/blobs` y una tarea
  programada `@daily`; ninguna de las dos existe fuera de Netlify.
- Las cabeceras de respuesta (`x-frame-options: DENY`, `x-content-type-options: nosniff`,
  `referrer-policy: strict-origin-when-cross-origin`) son exactamente las declaradas en
  [`netlify.toml`](../coyote-s-house/netlify.toml).

Puede ser que la VM tenga una copia del sitio pero el DNS aún apunte a Netlify, o que nginx
haga de proxy hacia allá. Se resuelve en un comando desde la VM:

```bash
curl -sI http://127.0.0.1/ | head -5     # ¿responde nginx local con el sitio?
sudo ls /var/www/coyoteshouse.cl 2>/dev/null || sudo nginx -T | grep -A5 server_name
```

**Por qué importa:** si el sitio se muda del todo a la VM, las reseñas de Google dejan de
funcionar hasta que esas dos funciones se reescriban (leer de Google Places, guardar el
snapshot en algún lado, y un `systemd timer` en vez del `@daily` de Netlify). Es trabajo
aparte y no bloquea el backend. **Este plan no lo incluye**; queda anotado en la sección 7.

---

## 2. Arquitectura objetivo

```
                        Cloudflare  (proxy naranja: CDN, TLS, WAF)
                       /                                        \
        coyoteshouse.cl                                   api.coyoteshouse.cl
        sitio estático                                            │
        (donde esté hoy)                                   nginx :443  ← cert de origen CF
                │                                                 │  proxy_pass
                │  fetch /api/public/site-config           127.0.0.1:3000
                └────────────────────────────────────────►  Fastify (systemd)
                                                                  │
                                                          Neon · production
                                                          sa-east-1 (São Paulo)
```

### Por qué un subdominio y no `coyoteshouse.cl/api/`

Servir el backend bajo el mismo dominio evitaría CORS, pero solo funciona si el sitio está
en la VM — y eso es justo lo que está en duda. `api.coyoteshouse.cl` funciona en los dos
escenarios y no obliga a decidir nada hoy:

- El endpoint público ya registra CORS con `origin: '*'` en
  [`public.routes.js`](src/routes/public.routes.js), así que el sitio lo consume desde
  cualquier dominio.
- El panel se sirve desde el propio backend (`/admin/`), o sea mismo origen: las rutas de
  administración siguen sin CORS y cerradas a peticiones de otros sitios, que es el diseño
  original.

Si más adelante confirmas que el sitio está en la VM y prefieres un solo origen, el cambio
es solo de nginx y una línea en `site-config.js`.

---

## 3. Preparación antes de tocar la VM

### 3.1 Aplicar el esquema a Neon `production`

Es el paso 4.7 que quedó pendiente en `plan.md`. Desde tu máquina:

```bash
cd backend-coyote-s-house
npm run db:migrate     # crea las 4 tablas (idempotente)
npm run db:seed        # vuelca data/*.json
```

Ninguno destruye nada: `production` está vacía y ambos se pueden repetir.

### 3.2 Sacar `@neon/config` y `@neon/env` de las dependencias de producción

`package.json` los declara en `dependencies`, pero **nada en `src/` los importa**: son
herramientas del CLI de Neon, no del servidor. Arrastran `@neon/sdk`, `jiti`, `yargs`, `zod`
y un módulo nativo (`@napi-rs/keyring`) que en la VM instalaría el binario ARM de un llavero
que el backend no usa.

```bash
npm uninstall @neon/config @neon/env
npm install --save-dev @neon/config @neon/env
npm test        # confirmar que sigue en verde
```

Así `npm ci --omit=dev` en el servidor instala solo lo que el proceso necesita.

### 3.3 Confirmar la versión de Node en la VM

```bash
node -v      # tiene que ser >= 20.11.0 (lo declara package.json)
```

Si es menor, instalar Node 22 LTS para ARM64 antes de seguir.

### 3.4 Google Cloud Console

Dos cosas, en *APIs y servicios*:

1. **Credenciales → tu ID de cliente OAuth**, agregar:
   - URI de redireccionamiento autorizado: `https://api.coyoteshouse.cl/auth/google/callback`
   - Origen JavaScript autorizado: `https://api.coyoteshouse.cl`

   No borres `http://localhost:3000/auth/google/callback`: sirve para seguir probando local.

2. **Pantalla de consentimiento.** Si el proyecto está en *Testing*, solo entran los correos
   listados como usuarios de prueba. Agrega ahí el de don Alberto, o publica la aplicación.
   Publicarla **no requiere verificación de Google** en este caso, porque los únicos permisos
   que pide son `openid`, `email` y `profile`, que no son sensibles.

Y en el `.env` del servidor, `ADMIN_ALLOWED_EMAILS` tiene que incluir el correo de Alberto:
hoy solo está el tuyo, y sin eso recibe un 403 aunque el login de Google funcione.

---

## 4. La VM

### 4.1 Usuario propio y código

El backend no debe correr como `root` ni como tu usuario de SSH.

```bash
sudo useradd --system --home /opt/coyote --shell /sbin/nologin coyote
sudo mkdir -p /opt/coyote
sudo chown coyote:coyote /opt/coyote

sudo -u coyote git clone https://github.com/Nixelaos/backend-coyote-s-house.git /opt/coyote/backend
cd /opt/coyote/backend
sudo -u coyote npm ci --omit=dev
```

### 4.2 Variables de entorno

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

PUBLIC_BASE_URL=https://api.coyoteshouse.cl

GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
SESSION_SECRET=...
ADMIN_ALLOWED_EMAILS=nnicolaslf@gmail.com,correo-de-alberto@gmail.com

STORAGE_DRIVER=neon
DATABASE_URL=<cadena de la rama production>
```

Notas:

- **`NODE_ENV=production` no es decorativo.** Activa la cookie `Secure`, HSTS y
  `trustProxy` en [`server.js:58`](src/server.js#L58). Sin eso el login no funciona sobre
  HTTPS.
- `ALLOWED_ORIGINS` **no hace falta**: hoy `config.js` la lee pero ningún módulo la consume.
  Está reservada para más adelante.
- Con `STORAGE_DRIVER=neon`, la carpeta `data/` deja de usarse por completo.

### 4.3 Servicio de systemd

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
difícil de leer.

### 4.4 SELinux — el tropiezo clásico de Oracle Linux

Con SELinux en *enforcing*, nginx **no puede** conectarse a un puerto local. El proxy
devuelve 502 y el log dice `Permission denied` sin más explicación:

```bash
sudo setsebool -P httpd_can_network_connect 1
```

### 4.5 nginx

`/etc/nginx/conf.d/api.coyoteshouse.cl.conf`:

```nginx
# --- IP real del visitante -------------------------------------------------
# Sin esto, todas las peticiones llegan con la IP de Cloudflare y el limitador
# de @fastify/rate-limit las mete en un solo cubo: un abusivo dejaría a todos
# los demás con 429.
# Lista de cloudflare.com/ips-v4 e ips-v6, verificada el 2026-09-09. Cambia muy
# de vez en cuando; vale revisarla si algún día el límite empieza a contar mal.
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
set_real_ip_from 103.22.200.0/22;
set_real_ip_from 103.31.4.0/22;
set_real_ip_from 141.101.64.0/18;
set_real_ip_from 108.162.192.0/18;
set_real_ip_from 190.93.240.0/20;
set_real_ip_from 188.114.96.0/20;
set_real_ip_from 197.234.240.0/22;
set_real_ip_from 198.41.128.0/17;
set_real_ip_from 162.158.0.0/15;
set_real_ip_from 104.16.0.0/13;
set_real_ip_from 104.24.0.0/14;
set_real_ip_from 172.64.0.0/13;
set_real_ip_from 131.0.72.0/22;
set_real_ip_from 2400:cb00::/32;
set_real_ip_from 2606:4700::/32;
set_real_ip_from 2803:f800::/32;
set_real_ip_from 2405:b500::/32;
set_real_ip_from 2405:8100::/32;
set_real_ip_from 2a06:98c0::/29;
set_real_ip_from 2c0f:f248::/32;
real_ip_header CF-Connecting-IP;

server {
    listen 443 ssl;
    http2 on;
    server_name api.coyoteshouse.cl;

    # Certificado de origen de Cloudflare (ver 4.6)
    ssl_certificate     /etc/ssl/cloudflare/coyoteshouse.pem;
    ssl_certificate_key /etc/ssl/cloudflare/coyoteshouse.key;

    # El backend limita el cuerpo a 64 KB; nginx corta antes.
    client_max_body_size 128k;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 30s;
    }
}

server {
    listen 80;
    server_name api.coyoteshouse.cl;
    return 301 https://$host$request_uri;
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 4.6 Certificado de origen

En Cloudflare: **SSL/TLS → Origin Server → Create Certificate**. Emite un certificado válido
15 años, gratis, que solo Cloudflare valida. Guardar en la VM:

```bash
sudo mkdir -p /etc/ssl/cloudflare
sudo install -m 0644 /dev/null /etc/ssl/cloudflare/coyoteshouse.pem   # pegar el certificado
sudo install -m 0600 /dev/null /etc/ssl/cloudflare/coyoteshouse.key   # pegar la clave
```

Se prefiere al de Let's Encrypt porque no expira cada 90 días ni necesita que el puerto 80
quede abierto para renovar. El navegador nunca lo ve: ve el certificado de Cloudflare.

### 4.7 Cortafuegos: que solo entre Cloudflare

Esta es la "primera capa" que pediste. Sin ella, cualquiera que averigüe la IP de la VM
—y hay buscadores que las indexan— habla directo con nginx y se salta el WAF, el CDN y
el límite de peticiones de Cloudflare.

```bash
# Zona dedicada que solo acepta a Cloudflare en 80/443
sudo firewall-cmd --permanent --new-zone=cloudflare
sudo firewall-cmd --permanent --zone=cloudflare --add-service=http --add-service=https
for ip in $(curl -s https://www.cloudflare.com/ips-v4) $(curl -s https://www.cloudflare.com/ips-v6); do
  sudo firewall-cmd --permanent --zone=cloudflare --add-source=$ip
done

# Y quitar http/https de la zona pública
sudo firewall-cmd --permanent --zone=public --remove-service=http --remove-service=https
sudo firewall-cmd --reload
```

> Ojo: si el sitio estático también se sirve desde esta VM, esto lo deja igual de protegido
> —bien— pero cualquier prueba con `curl` contra la IP pública dejará de responder. Es lo
> esperado.

Complemento recomendado: **Authenticated Origin Pulls** (SSL/TLS → Origin Server), que hace
que nginx exija un certificado de cliente firmado por Cloudflare. Cinturón y tirantes.

### 4.8 Cloudflare

1. **DNS:** registro `A` de `api` → IP pública de la VM, **proxy activado** (nube naranja).
2. **SSL/TLS → Overview:** modo **Full (strict)**. Con "Flexible" el tramo Cloudflare→VM
   viaja en claro y, peor, el backend recibiría `X-Forwarded-Proto: http`.
3. **SSL/TLS → Edge Certificates:** *Always Use HTTPS* activado.
4. **Caching → Cache Rules**, dos reglas en este orden:

   | Orden | Expresión | Acción |
   |---|---|---|
   | 1 | `starts_with(http.request.uri.path, "/api/admin") or starts_with(http.request.uri.path, "/auth") or starts_with(http.request.uri.path, "/admin")` | **Bypass cache** |
   | 2 | `http.request.uri.path eq "/api/public/site-config"` | **Eligible for cache**, respetar TTL del origen |

   La primera es obligatoria: cachear `/auth/*` rompería el parámetro `state` del login y
   cachear `/api/admin/*` podría servirle a alguien la respuesta de otra sesión. El backend
   ya manda `no-store` ahí, pero una regla explícita no depende de que Cloudflare la respete.

   La segunda es la que da el CDN: el endpoint público ya emite
   `public, max-age=60, stale-while-revalidate=600`, pero Cloudflare **no cachea JSON por
   defecto**, así que sin la regla cada visita golpea la VM y despierta Neon.

5. *Opcional:* una regla de **Rate limiting** sobre `/auth/google` (el plan gratuito permite
   una), para que nadie muela el login.

---

## 5. El sitio público

Un solo cambio, en
[`coyote-s-house/js/lib/site-config.js:34`](../coyote-s-house/js/lib/site-config.js#L34),
donde hoy hay una URL de Render que no existe:

```js
return esLocal ? 'http://localhost:3000' : 'https://api.coyoteshouse.cl';
```

No hace falta tocar CORS: el endpoint público ya responde a cualquier origen.

Si el sitio sigue en Netlify, basta con hacer push al repo. Si está en la VM, `git pull` en
la carpeta que sirva nginx.

---

## 6. Verificación

Desde fuera de la VM:

```bash
curl -s https://api.coyoteshouse.cl/health
curl -s https://api.coyoteshouse.cl/api/public/site-config | head -c 200
curl -sI https://api.coyoteshouse.cl/api/admin/schedule | head -3   # debe ser 401
```

Desde la VM, que la IP real esté llegando (si el log muestra la IP de Cloudflare, falta
`real_ip`):

```bash
journalctl -u coyote-backend -n 20
```

Y a mano:

1. Entrar a `https://api.coyoteshouse.cl/admin/`, iniciar sesión con Google.
2. Cambiar el horario y guardar.
3. Recargar `https://coyoteshouse.cl` → la barra de horario refleja el cambio (puede tardar
   hasta 60 s por la caché).
4. `sudo systemctl restart coyote-backend` → el horario **persiste**. Es la prueba de que la
   migración a Neon sirvió para algo.
5. `sudo systemctl stop coyote-backend` → el sitio sigue en pie con el horario de respaldo,
   sin banner y con el diseño intacto.

Comprobar desde tu máquina que la fila quedó escrita, con la cadena de `production`:

```sql
select day_index, open_time, close_time, updated_by from schedule_days order by day_index;
select entity, changed_by, changed_at from audit_log order by id desc limit 5;
```

---

## 7. Riesgos y cosas que quedan fuera

1. **Las reseñas de Google.** Si el sitio se muda del todo a la VM, las dos funciones de
   Netlify dejan de existir y la sección de reseñas queda vacía. Reescribirlas es un trabajo
   aparte: un endpoint en Fastify que sirva el último snapshot, un `systemd timer` diario
   que consulte Google Places con `GOOGLE_PLACES_API_KEY`, y un lugar donde guardar el JSON
   —ahora que hay Postgres, una tabla es lo más simple.

2. **Neon se apaga sola.** En el plan gratuito la base se suspende tras unos minutos sin
   uso, y la primera petición después tarda unos segundos en despertarla. Con la regla 2 de
   caché el sitio público casi no lo nota; el panel sí, la primera vez que Alberto entra en
   el día. No es un error, pero conviene saberlo antes de salir a depurar algo que no está
   roto.

3. **Latencia.** Neon está en `sa-east-1` (São Paulo). Si la VM de Oracle está en Chile o
   Brasil, son decenas de milisegundos. Si quedó en otro continente, cada carga del panel lo
   va a notar. Vale la pena mirarlo antes de dar por cerrado el despliegue.

4. **La API key de Neon del `plan.md`.** Sigue pendiente: `neon mcp -y` acuñó una llave con
   alcance total sobre la cuenta y la escribió en seis archivos de configuración de tu
   equipo. Revocarla con `neon api-keys revoke 3324682` y emitir una acotada al proyecto.

5. **Respaldos.** Neon guarda historial para restauración puntual, pero conviene dejar un
   snapshot explícito antes de cada cambio grande de esquema: `neon snapshot create`.

6. **Actualizar el backend** una vez desplegado:

   ```bash
   cd /opt/coyote/backend
   sudo -u coyote git pull
   sudo -u coyote npm ci --omit=dev
   sudo systemctl restart coyote-backend
   ```

---

## 8. Orden sugerido

```
3.1 esquema en Neon production
        ↓
3.2 limpiar dependencias  ──►  3.4 Google Cloud Console
        ↓
4.1 usuario y código  ──►  4.2 .env  ──►  4.3 systemd  ──►  4.4 SELinux
        ↓
4.8 DNS de Cloudflare (proxy)  ──►  4.6 certificado  ──►  4.5 nginx
        ↓
verificar que /health responde por HTTPS
        ↓
4.7 cortafuegos solo-Cloudflare  ──►  4.8 reglas de caché
        ↓
5. API_BASE del sitio
        ↓
6. verificación + probar el login de Alberto
```

El cortafuegos va **después** de comprobar que todo responde: si lo cierras antes y algo
falla, no vas a saber si el problema es nginx, el certificado o el propio cortafuegos.
