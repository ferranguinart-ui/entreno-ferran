# Entreno — Training Tracker (Fases 1 + 2)

App autoalojada para correr los entrenos por tiempo, registrar reps y anotar
medidas corporales. Móvil primero, usable en escritorio. Un solo usuario (PIN).

Destino: `entreno.ferranguinart.com` (Hostinger).

## Fase 2 — Dashboard (`#/dashboard`)

- **Peso**: registros + media móvil de 7, línea de objetivo (70 kg), ▲ para
  entradas fuera de condiciones estándar.
- **Cintura**: registros + media móvil de 7.
- **Consistencia**: heatmap de 12 semanas, objetivo 4/semana, semanas de deload
  en morado.
- **Progresión de fuerza**: reps/40 s por ejercicio, agrupado en Empuje /
  Tracción / Piernas, con las sesiones de deload marcadas (▲).
- Gráficos con Chart.js por CDN; medias móviles y agregados se calculan en cliente.

## Qué incluye la Fase 1

- **Runner de timer**: calentamiento → rondas → descansos → remate opcional,
  a pantalla completa, con beep y vibración (Android) en cada cambio de fase,
  pausa/saltar/anterior, y aviso de "siguiente".
  - Wake Lock (la pantalla no se apaga), audio desbloqueado al primer toque,
    cuenta atrás anclada a reloj real (sin drift ni congelarse en segundo plano).
- **Deload**: toggle que fija las rondas en 2 sin tocar el plan.
- **Rondas ajustables** antes de cada entreno (2–6, por defecto 3).
- **Registro de sesión**: al acabar el timer o manualmente. Reps de la ronda 1
  por ejercicio, con el último valor precargado.
- **Medidas corporales**: peso y cintura, flag de condiciones estándar, notas.
- **Cola offline**: el timer no necesita red; si el guardado final falla, queda
  en el navegador y se sube solo al reconectar.
- **PWA**: instalable en la pantalla de inicio, arranca a pantalla completa.

Fuera de alcance por ahora (Fase 3): fotos de progreso, export CSV,
notificación semanal.

## Estructura

```
db/schema.sql            esquema PostgreSQL (idempotente)
db/seed.sql              el plan de Ferran como datos (idempotente)
plan/plan.json           versión editable del plan (referencia)
backend/                 FastAPI (API + sirve el frontend)
backend/tests/           pytest sobre Postgres real
frontend/                vanilla JS/HTML/CSS, sin build
frontend/js/timer.test.mjs  tests del motor de timer (node --test)
deploy/bootstrap.sh      puesta en marcha completa en el VPS (idempotente)
deploy/update.sh         actualización tras cada deploy
deploy/entreno.service   unit de systemd
deploy/nginx-entreno.conf  server block de nginx
deploy/DEPLOY.md         guía paso a paso
.github/workflows/ci.yml CI (tests) + CD (deploy al VPS en push a main)
```

## Desarrollo local

```bash
make setup       # crea venv e instala deps (dev)
make dev         # uvicorn --reload en :8000  (necesita backend/.env)
make test        # tests de timer + API  (necesita un Postgres local en $DB)
make db-reset    # recrea la BD local desde schema.sql + seed.sql
```

`backend/.env` a partir de `.env.example`: `DATABASE_URL`, `SESSION_SECRET`,
`INITIAL_PIN` (solo 1ª vez), `COOKIE_SECURE=0` en local. Python 3.9+.

## Despliegue (VPS Hostinger)

PostgreSQL local + `uvicorn` bajo systemd + nginx + Certbot. Detalle en
[deploy/DEPLOY.md](deploy/DEPLOY.md). Resumen:

**1. Una sola vez, en el VPS como root:**

```bash
sudo REPO_URL=https://github.com/USUARIO/entreno-ferran.git \
     DOMAIN=entreno.ferranguinart.com APP_PIN=TU_PIN \
     bash deploy/bootstrap.sh
```

Instala todo, crea la BD, carga esquema + datos, levanta el servicio y nginx.
Luego, cuando el DNS A de `entreno` apunte al VPS: `sudo certbot --nginx -d entreno.ferranguinart.com`.

**2. Deploy continuo:** el VPS se despliega solo. `entreno-deploy.timer` (systemd)
sondea `origin/main` cada 2 min; si hay commits nuevos hace `git reset --hard` +
`deploy/update.sh`. El repo es público, así que el VPS no necesita credenciales
de GitHub y no hay *secrets* que configurar. GitHub Actions solo corre los tests.

## Notas de implementación

- **iOS**: la Vibration API no existe en Safari iOS — sólo suena el beep. El
  audio se activa con el botón "Toca para empezar" (requisito de iOS).
- **Reps por ronda**: el MVP guarda sólo la ronda 1. `session_logs.round_number`
  ya existe: pasar a "apuntar todas las rondas" es sólo cambiar la UI.
- **Salir a media sesión**: se descarta, no se guarda. (Mejorable más adelante.)
- **Iconos** en `frontend/icons/` son un placeholder azul liso — reemplázalos
  cuando quieras por unos de verdad (192 y 512 px).
- Editar el plan más adelante = editar `db/seed.sql` (o `plan/plan.json`) y
  re-ejecutar el seed; no hace falta tocar código.
