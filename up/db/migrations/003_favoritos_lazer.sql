-- 003: favoritos e biblioteca de lazer (com capas).

create table favorites (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  client_id  text,
  name       text not null check (length(name) between 1 and 80),
  url        text not null check (length(url) <= 2000 and url ~* '^https?://'),
  category   text not null default 'Dia a dia' check (length(category) between 1 and 40),
  pinned     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_id)
);
create index favorites_user_idx on favorites (user_id);

create table leisure_items (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  client_id     text,
  kind          text not null check (kind in ('jogo', 'filme', 'serie')),
  title         text not null check (length(title) between 1 and 120),
  platform      text not null default '' check (length(platform) <= 60),
  status        text not null default 'pendente' check (status in ('pendente', 'andamento', 'concluido')),
  progress      integer not null default 0 check (progress between 0 and 100),
  cover_width   integer,
  cover_height  integer,
  cover_version integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, client_id)
);
create index leisure_user_idx on leisure_items (user_id);

-- Capas JPEG já reduzidas pelo navegador, em base64 (evita problemas de bytea em drivers HTTP).
create table leisure_covers (
  item_id     uuid primary key references leisure_items(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  mime        text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  data_base64 text not null check (length(data_base64) <= 900000),
  updated_at  timestamptz not null default now()
);
