-- 004: eventos da agenda e integração com o Google Calendar.
-- Eventos são independentes das tarefas.

create table events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  client_id     text,
  title         text not null check (length(title) between 1 and 200),
  date          date not null,                    -- data da primeira ocorrência
  all_day       boolean not null default true,
  start_time    text check (start_time is null or start_time ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  end_time      text check (end_time is null or end_time ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  category      text not null default 'pessoal' check (category in ('pessoal','trabalho','estudos','saude','lazer')),
  notes         text not null default '' check (length(notes) <= 4000),
  rec_type      text not null default 'nenhuma' check (rec_type in ('nenhuma','diaria','semanal','mensal','anual')),
  rec_weekdays  integer[] not null default '{}' check (rec_weekdays <@ array[0,1,2,3,4,5,6]),
  rec_until     date,
  exceptions    text[] not null default '{}',      -- datas AAAA-MM-DD excluídas individualmente

  -- Vínculo com o Google Calendar
  google_event_id        text,
  google_etag            text,
  google_updated         timestamptz,
  sync_state             text not null default 'local'
                         check (sync_state in ('local','pending','synced','pending_delete','error','readonly')),
  sync_error             text,
  unsupported_recurrence boolean not null default false,  -- recorrência do Google que o dashboard não representa
  deleted_at             timestamptz,                     -- exclusão local aguardando propagação

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, client_id),
  unique (user_id, google_event_id)
);
create index events_user_idx on events (user_id) where deleted_at is null;
create index events_sync_idx on events (user_id, sync_state);

create table calendar_connections (
  user_id            uuid primary key references users(id) on delete cascade,
  google_email       text,
  calendar_id        text not null default 'primary',
  refresh_token_enc  text not null,               -- AES-256-GCM, nunca em texto puro
  scopes             text not null default '',
  status             text not null default 'connected' check (status in ('connected','revoked','error')),
  sync_token         text,
  sync_lock_until    timestamptz,
  last_sync_at       timestamptz,
  last_error         text,
  connected_at       timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table import_runs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  summary    jsonb not null,
  created_at timestamptz not null default now()
);
create index import_runs_user_idx on import_runs (user_id);
