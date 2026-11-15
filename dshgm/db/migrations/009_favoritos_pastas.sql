-- 009: pastas de favoritos e escolha da barra (central ou superior).
--
-- Cada favorito passa a ter a barra em que aparece. Um favorito dentro de uma pasta sempre herda a barra da
-- pasta (o servidor mantém os dois alinhados). Ao excluir uma pasta, os links NÃO são apagados: ficam soltos.
-- Favoritos já existentes ficam na barra central, como era antes.
create table favorite_folders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  name       text not null check (length(name) between 1 and 40),
  bar        text not null default 'central' check (bar in ('central', 'superior')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index favorite_folders_nome_unico on favorite_folders (user_id, lower(name));
create index favorite_folders_user_idx on favorite_folders (user_id);

alter table favorites
  add column folder_id uuid references favorite_folders(id) on delete set null,
  add column bar text not null default 'central' check (bar in ('central', 'superior'));
create index favorites_folder_idx on favorites (folder_id);
