-- 001: usuários, sessões e preferências.
-- Migração apenas aditiva (sem DROP/DELETE de dados).

create table users (
  id            uuid primary key default gen_random_uuid(),
  google_sub    text not null unique,            -- identificador estável do Google (claim "sub")
  email         text not null,
  email_verified boolean not null default false,
  name          text not null default '',
  picture_url   text,
  timezone      text not null default 'America/Sao_Paulo',
  created_at    timestamptz not null default now(),
  last_login_at timestamptz not null default now()
);

-- Só o hash SHA-256 do identificador da sessão é guardado: um vazamento do banco não entrega sessões válidas.
create table sessions (
  id_hash              text primary key,
  user_id              uuid not null references users(id) on delete cascade,
  csrf_token           text not null,
  created_at           timestamptz not null default now(),
  last_seen_at         timestamptz not null default now(),
  expires_at           timestamptz not null,   -- expiração por inatividade (deslizante)
  absolute_expires_at  timestamptz not null    -- limite máximo, independe de atividade
);
create index sessions_user_idx on sessions (user_id);
create index sessions_expires_idx on sessions (expires_at);

create table preferences (
  user_id    uuid primary key references users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  photo      text,                                -- data URL já reduzida pelo navegador
  updated_at timestamptz not null default now(),
  constraint preferences_photo_size check (photo is null or length(photo) <= 600000)
);
