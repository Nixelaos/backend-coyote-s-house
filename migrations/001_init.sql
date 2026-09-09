-- 001_init.sql — esquema inicial de Coyote's House en Postgres (Neon).
--
-- Aplicar con:  npm run db:migrate
-- Es idempotente (todo va con "if not exists"): correrlo dos veces no rompe nada.

-- Las horas se guardan como texto 'HH:MM' a propósito: es el formato exacto que ya
-- validan los esquemas y que consumen el panel y el sitio. Usar el tipo `time`
-- obligaría a reformatear '09:00:00' -> '09:00' en cada lectura, sin ganar nada.
create table if not exists schedule_days (
  day_index  smallint primary key check (day_index between 0 and 6),
  open_time  text not null check (open_time  ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  close_time text not null check (close_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  closed     boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists schedule_exceptions (
  exception_date date primary key,
  closed     boolean not null default true,
  open_time  text check (open_time  ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  close_time text check (close_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  label      text not null default '',
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Fila única: el sitio tiene un solo banner.
create table if not exists banners (
  id         smallint primary key default 1 check (id = 1),
  enabled    boolean not null default false,
  message    text not null default '',
  link_url   text not null default '',
  speed      text not null default 'normal' check (speed in ('slow','normal','fast')),
  starts_at  timestamptz,
  ends_at    timestamptz,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- En JSON no valía la pena; en Postgres sale gratis y responde
-- "quién cambió el horario y cuándo".
create table if not exists audit_log (
  id         bigserial primary key,
  entity     text not null check (entity in ('schedule', 'banner')),
  payload    jsonb not null,
  changed_by text not null,
  changed_at timestamptz not null default now()
);

create index if not exists audit_log_entity_fecha_idx
  on audit_log (entity, changed_at desc);
