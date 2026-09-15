# Despliegue — Coyote's House

VM de Oracle (Linux ARM) con nginx, detrás de Cloudflare. Sin base de datos.

```
Visitante ─► Cloudflare ─► nginx ─┬─► archivos del sitio (HTML, CSS, JS, reseñas)
                                  └─► /api/ /admin /auth/ /health ─► Fastify :3000 ─► /var/lib/coyote/*.json
```

- El sitio es estático y Cloudflare lo cachea. Cada página pide el horario y el anuncio a
  `/api/public/site-config`, que **no** se cachea.
- Sin horario guardado, o con el backend caído, el sitio carga igual pero sin horario ni anuncio.

---

## 1. Antes de tocar la VM

1. Commit y push de los tres repos.
2. **Google Cloud Console → Credenciales → cliente OAuth:**
   - URI de redirección: `https://coyoteshouse.cl/auth/google/callback`
   - Origen JavaScript: `https://coyoteshouse.cl`
   - Si la pantalla de consentimiento está en *Testing*, agrega como usuarios de prueba los
     correos que entrarán al panel.

## 2. Backend

### 2.1 Usuario, datos y código

```bash
node -v    # >= 20.11; y `command -v node` debe coincidir con ExecStart (2.3)

sudo useradd --system --home /opt/coyote --shell /sbin/nologin coyote
sudo install -d -o coyote -g coyote -m 0750 /opt/coyote /var/lib/coyote
sudo install -d -o coyote -g coyote -m 0700 /opt/coyote/.ssh

# Deploy key de solo lectura (el repo del backend es privado)
sudo -u coyote ssh-keygen -t ed25519 -N "" -C "deploy coyote-backend" -f /opt/coyote/.ssh/id_ed25519
sudo cat /opt/coyote/.ssh/id_ed25519.pub
```

GitHub → `backend-coyote-s-house` → **Settings → Deploy keys → Add deploy key**, sin marcar
"Allow write access".

```bash
ssh-keyscan -t ed25519 github.com | sudo -u coyote tee -a /opt/coyote/.ssh/known_hosts
sudo -u coyote -H git clone git@github.com:Nixelaos/backend-coyote-s-house.git /opt/coyote/backend
cd /opt/coyote/backend && sudo -u coyote -H npm ci --omit=dev
```

### 2.2 Variables de entorno

```bash
sudo mkdir -p /etc/coyote
sudo install -o root -g coyote -m 0640 /dev/null /etc/coyote/backend.env
sudo vi /etc/coyote/backend.env
```

```ini
NODE_ENV=production
PORT=3000
HOST=127.0.0.1
PUBLIC_BASE_URL=https://coyoteshouse.cl
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
SESSION_SECRET=...
ADMIN_ALLOWED_EMAILS=nnicolaslf@gmail.com
DATA_DIR=/var/lib/coyote
```

- `HOST=127.0.0.1`: solo nginx habla con el backend.
- `SESSION_SECRET` nuevo, distinto del local: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
- Agregar un correo al panel = editar `ADMIN_ALLOWED_EMAILS` y `sudo systemctl restart coyote-backend`.

### 2.3 Servicio — `/etc/systemd/system/coyote-backend.service`

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
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/coyote

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now coyote-backend
curl -s http://127.0.0.1:3000/health
```

### 2.4 SELinux

```bash
sudo setsebool -P httpd_can_network_connect 1
```

Sin esto nginx no puede conectarse a Fastify y responde 502.

## 3. nginx

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

IP real del visitante (sin esto el límite de peticiones ve a todos como Cloudflare):

```bash
{ curl -fsS https://www.cloudflare.com/ips-v4; echo; curl -fsS https://www.cloudflare.com/ips-v6; echo; } \
  | grep -v '^$' | sed 's/^/set_real_ip_from /; s/$/;/' \
  | sudo tee /etc/nginx/conf.d/cloudflare-real-ip.inc >/dev/null
echo 'real_ip_header CF-Connecting-IP;' | sudo tee -a /etc/nginx/conf.d/cloudflare-real-ip.inc >/dev/null
```

Dentro del `server` que ya sirve `coyoteshouse.cl`:

```nginx
    include /etc/nginx/conf.d/cloudflare-real-ip.inc;
    client_max_body_size 128k;

    location /api/     { include /etc/nginx/conf.d/coyote-backend.inc; }
    location /auth/    { include /etc/nginx/conf.d/coyote-backend.inc; }
    location /admin/   { include /etc/nginx/conf.d/coyote-backend.inc; }
    location = /admin  { return 301 /admin/; }
    location = /health { include /etc/nginx/conf.d/coyote-backend.inc; }
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

`www.coyoteshouse.cl` conviene redirigirlo a `https://coyoteshouse.cl`: el login de Google solo
funciona en la URL de `PUBLIC_BASE_URL`.

## 4. Cloudflare

**Caching → Cache Rules → Create rule:**

- Nombre: `Sin caché: API, panel y login`
- Custom filter expression → **Edit expression**:
  ```
  starts_with(http.request.uri.path, "/api/") or starts_with(http.request.uri.path, "/admin") or starts_with(http.request.uri.path, "/auth/") or http.request.uri.path eq "/health"
  ```
- Cache eligibility: **Bypass cache** · Place at: **Last** · **Deploy**

La regla que cachea el sitio queda como está.

## 5. Sitio

En la carpeta que sirve nginx (`grep -rn "root " /etc/nginx/`):

```bash
git pull
```

Luego, en Cloudflare: **Caching → Configuration → Purge Everything**.

## 6. Primer horario

Entra a `https://coyoteshouse.cl/admin/`, revisa el horario y **guarda**. Hasta entonces el sitio
no muestra horario ni anuncio.

## 7. Verificación

```bash
curl -sI https://coyoteshouse.cl/api/public/site-config | grep -iE "^HTTP|cf-cache-status|cache-control"
#   200 · cf-cache-status: DYNAMIC · cache-control: no-cache
curl -sI https://coyoteshouse.cl/api/admin/schedule | head -1    # 401
curl -s  https://coyoteshouse.cl/health
```

Si sale `HIT`, la regla de Cloudflare no aplica; si sale `max-age=14400`, Cloudflare está
reescribiendo la cabecera.

A mano:

1. Cambia el horario en el panel → recarga el sitio en incógnito: se ve al tiro (en una pestaña ya
   abierta, hasta 5 minutos).
2. `sudo systemctl restart coyote-backend` → el horario sigue.
3. `sudo systemctl stop coyote-backend` → el sitio carga sin horario ni anuncio. Vuelve a
   encenderlo con `start`.

## 8. Mantención

```bash
cd /opt/coyote/backend
sudo -u coyote -H git pull
sudo -u coyote -H npm ci --omit=dev
sudo systemctl restart coyote-backend
```

- **Respaldo:** basta con copiar `/var/lib/coyote/schedule.json` y `banner.json`.
- **Opcional:** Cloudflare SSL en *Full (strict)* si el certificado de nginx es de Let's Encrypt
  u Origin CA (con uno autofirmado rompe el sitio).
