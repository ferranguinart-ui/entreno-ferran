-- Training Tracker — esquema (PostgreSQL 13+)
-- Idempotente: se puede re-ejecutar sin error (create ... if not exists).
-- Revisión post-PRD: incorpora lo que el plan real de Ferran dejó ver
-- (calentamiento compartido con tiempos propios, remates opcionales,
--  rondas variables 3-4 en HIIT, deload = bajar a 2 rondas, normalización reps/40s).

-- ---------------------------------------------------------------------------
-- Auth: un solo usuario (Ferran). PIN hasheado (argon2/bcrypt en la app).
-- ---------------------------------------------------------------------------
create table if not exists users (
  id         uuid primary key default gen_random_uuid(),
  pin_hash   text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Ajustes: fila única. El objetivo cambia en Fase 2 (build), no hardcodear.
-- ---------------------------------------------------------------------------
create table if not exists settings (
  id                smallint primary key default 1 check (id = 1),
  user_id           uuid references users(id),
  goal_weight_kg    numeric(4,1) not null default 70,
  phase             text not null default 'deficit' check (phase in ('deficit','build')),
  moving_avg_window smallint not null default 7,     -- media móvil del dashboard
  weighin_reminder  text default 'En ayunas, tras café y baño, primera hora de la mañana.'
);

-- ---------------------------------------------------------------------------
-- Días de entrenamiento. id explícito y estable (se referencia como "Día 1").
-- id 0 = Calentamiento (bloque compartido que el runner antepone a cada día).
-- id 5 = Libre / full body (sin ejercicios fijos; solo registro manual).
-- ---------------------------------------------------------------------------
create table if not exists training_days (
  id             smallint primary key,
  name           text not null,          -- 'Empuje'
  focus          text,                   -- 'Empuje (mancuernas)'
  note           text,
  rounds         smallint not null,      -- rondas por defecto
  rounds_min     smallint not null,      -- para días de rango (HIIT 3-4)
  rounds_max     smallint not null,
  rounds_deload  smallint not null default 2,   -- semana de descarga
  work_sec       smallint not null default 40,  -- trabajo por defecto del día
  rest_ex_sec    smallint not null,      -- descanso entre ejercicios
  rest_round_sec smallint not null,      -- descanso entre rondas
  sort_order     smallint not null
);

-- ---------------------------------------------------------------------------
-- Ejercicios. block distingue calentamiento / principal / remate.
-- Los *_override son nullable: null = heredar del día.
-- Secuencia que arma el runner para el "Día N":
--   [ejercicios de day_id 0, block 'warmup', 1 vuelta]
--   → ronda 1..rounds de day_id N, block 'main'
--     (descanso tras cada ejercicio = rest_sec ó day.rest_ex_sec;
--      al cerrar ronda = day.rest_round_sec)
--   → block 'remate' de day_id N (los is_optional=true se ofrecen con un
--     "¿incluir X?" al llegar; el resto van directos)
-- ---------------------------------------------------------------------------
create table if not exists exercises (
  id               smallint primary key,
  day_id           smallint not null references training_days(id),
  block            text not null check (block in ('warmup','main','remate')),
  name             text not null,
  muscle_primary   text,
  muscle_secondary text,
  work_sec         smallint,   -- override del trabajo (calentamiento: 30/20/…)
  rest_sec         smallint,   -- override del descanso posterior (calentamiento: 0)
  rounds           smallint,   -- override de rondas (remates: 1)
  is_optional      boolean not null default false,
  note             text,
  sort_order       smallint not null
);

-- ---------------------------------------------------------------------------
-- Sesiones. Una por entrenamiento (timer o manual).
-- work_sec se guarda por sesión para poder normalizar reps a "reps/40s"
-- aunque el trabajo cambie en Fase 2.
-- ---------------------------------------------------------------------------
create table if not exists sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references users(id),
  day_id           smallint not null references training_days(id),
  date             date not null,          -- fecha LOCAL del cliente (Europe/Madrid)
  started_at       timestamptz,
  is_deload        boolean not null default false,
  rounds_completed smallint,               -- rondas realmente hechas
  work_sec         smallint not null default 40,
  duration_sec     integer,                -- exacto si timer; estimado/null si manual
  source           text not null check (source in ('timer','manual')),
  created_at       timestamptz not null default now()
);
create index if not exists sessions_user_date_idx on sessions (user_id, date);
create index if not exists sessions_day_date_idx on sessions (day_id, date);

-- ---------------------------------------------------------------------------
-- Registro de reps por ejercicio.
-- MVP: una fila por ejercicio con round_number = 1 (reps en fresco).
-- round_number existe ya para poder pasar a "apuntar todas las rondas"
-- sin migración: bastaría con que la UI escriba más filas.
-- reps null = no apuntado esta vez (el plan pide apuntar ~cada 2 semanas).
-- ---------------------------------------------------------------------------
create table if not exists session_logs (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references sessions(id) on delete cascade,
  exercise_id  smallint not null references exercises(id),
  round_number smallint not null default 1,
  reps         smallint,
  unique (session_id, exercise_id, round_number)
);

-- ---------------------------------------------------------------------------
-- Medidas corporales. weight/waist ambas nullable (semanas sin cinta).
-- is_standard_conditions se muestra solo sobre el gráfico de peso.
-- Columnas de foto presentes desde ya (se rellenan en Fase 3).
-- ---------------------------------------------------------------------------
create table if not exists body_measurements (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references users(id),
  date                   date not null,
  weight_kg              numeric(4,1),
  waist_cm               numeric(4,1),
  is_standard_conditions boolean not null default true,
  note                   text,
  photo_url_front        text,
  photo_url_side         text,
  created_at             timestamptz not null default now(),
  unique (user_id, date)
);
create index if not exists body_meas_user_date_idx on body_measurements (user_id, date);
