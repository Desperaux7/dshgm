-- 007: lista de desejos (produtos desejados, prioridade, preço estimado e marcação de compra).
--
-- Imagens: o projeto não tem serviço de arquivos configurado e imagens binárias não devem ficar no
-- PostgreSQL, então guardamos só o ENDEREÇO (image_url). Quando houver upload (ex.: object storage),
-- o arquivo vai para o armazenamento e a URL dele é gravada nesta mesma coluna: nada muda no esquema.
create table wishlist_items (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  name         text not null check (length(name) between 1 and 120),
  description  text not null default '' check (length(description) <= 500),
  link_url     text check (link_url is null or (length(link_url) <= 2000 and link_url ~* '^https?://')),
  image_url    text check (image_url is null or (length(image_url) <= 2000 and image_url ~* '^https?://')),
  price        numeric(12,2) not null check (price >= 0),
  priority     text not null default 'media' check (priority in ('alta', 'media', 'baixa')),
  status       text not null default 'desejado' check (status in ('desejado', 'comprado')),
  purchased_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- A data da compra existe se, e somente se, o item está comprado.
  check ((status = 'comprado') = (purchased_at is not null))
);
create index wishlist_items_user_idx on wishlist_items (user_id, priority, status);
