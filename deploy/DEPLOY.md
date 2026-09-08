# Despliegue en el VPS de Hostinger (KVM, Ubuntu)

Mismo patrón que `earny.ferranguinart.com`: PostgreSQL local + `uvicorn` bajo
systemd + nginx como proxy + Certbot para HTTPS. Cero cambios de código: la app
solo lee `DATABASE_URL`.

Puerto interno usado aquí: **8020** (cámbialo si choca con otro proyecto, en
`deploy/entreno.service` y `deploy/nginx-entreno.conf`).

## 1. PostgreSQL

```bash
sudo apt update && sudo apt install -y postgresql
sudo -u postgres psql -c "CREATE USER entreno WITH PASSWORD 'PON_UNA_BUENA';"
sudo -u postgres psql -c "CREATE DATABASE entreno OWNER entreno;"
```

Postgres ya escucha solo en `localhost` por defecto — no lo abras al exterior.

## 2. Código y base de datos

```bash
sudo useradd --system --create-home --home-dir /srv/entreno --shell /usr/sbin/nologin entreno
sudo -u entreno git clone <repo> /srv/entreno        # o sube los ficheros a /srv/entreno
cd /srv/entreno

sudo -u entreno psql "postgresql://entreno:PON_UNA_BUENA@localhost/entreno" -f db/schema.sql
sudo -u entreno psql "postgresql://entreno:PON_UNA_BUENA@localhost/entreno" -f db/seed.sql
```

## 3. Entorno Python

```bash
cd /srv/entreno/backend
sudo -u entreno python3 -m venv .venv
sudo -u entreno .venv/bin/pip install -r requirements.txt

sudo -u entreno cp ../.env.example .env
sudo -u entreno nano .env
```

`.env` para producción:

```
DATABASE_URL=postgresql://entreno:PON_UNA_BUENA@localhost:5432/entreno
SESSION_SECRET=<cadena larga y aleatoria: openssl rand -hex 32>
INITIAL_PIN=<tu PIN>          # solo se usa la 1ª vez; luego borra la línea
COOKIE_SECURE=1
```

## 4. Servicio systemd

```bash
sudo cp deploy/entreno.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now entreno
systemctl status entreno
journalctl -u entreno -f          # logs en vivo
```

Comprobación local: `curl -I http://127.0.0.1:8020/` debe dar `200`.

## 5. DNS

En el panel DNS de `ferranguinart.com`: registro **A** `entreno` → IP del VPS
(igual que hiciste con `earny`).

## 6. nginx + HTTPS

```bash
sudo cp deploy/nginx-entreno.conf /etc/nginx/sites-available/entreno.ferranguinart.com
sudo ln -s /etc/nginx/sites-available/entreno.ferranguinart.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d entreno.ferranguinart.com
```

Certbot añade el bloque 443 y la redirección 80→443. La cookie de sesión ya va
con `Secure` por `COOKIE_SECURE=1`.

## 7. Firewall (si no está ya)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

## Actualizar la app

```bash
cd /srv/entreno && sudo -u entreno git pull
sudo -u entreno backend/.venv/bin/pip install -r backend/requirements.txt   # si cambió
sudo systemctl restart entreno
```

El service worker es *network-first*: al recargar, el navegador coge la versión
nueva; la caché solo actúa sin conexión.

## Cambios de plan de entrenamiento

Editar `db/seed.sql` (o `plan/plan.json`) y re-ejecutar el seed — es idempotente:

```bash
sudo -u entreno psql "postgresql://entreno:PON_UNA_BUENA@localhost/entreno" -f db/seed.sql
```

## Backup (recomendado)

`crontab -e` del usuario `postgres` o root:

```
15 4 * * *  pg_dump -Fc entreno > /srv/entreno/backups/entreno-$(date +\%F).dump && find /srv/entreno/backups -name 'entreno-*.dump' -mtime +30 -delete
```

(La Fase 3 añadirá export CSV desde la propia app como red de seguridad extra.)
