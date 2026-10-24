-- 002: tarefas, conclusões por dia, movimentações financeiras e meta.
-- Tarefas NÃO se relacionam com eventos do calendário: são entidades independentes.

create table tasks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  client_id  text,                                -- id antigo do localStorage (idempotência da importação)
  text       text not null check (length(text) between 1 and 300),
  kind       text not null check (kind in ('unica', 'recorrente')),
  date       date,                                -- só para tarefas únicas
  weekdays   integer[] not null default '{}',     -- 0 = domingo ... 6 = sábado (recorrentes)
  created_on date not null default current_date,  -- recorrentes só aparecem a partir daqui
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_id),
  constraint tasks_unica_tem_data check (kind <> 'unica' or date is not null),
  constraint tasks_weekdays_validos check (weekdays <@ array[0,1,2,3,4,5,6])
);
create index tasks_user_idx on tasks (user_id);

create table task_completions (
  task_id uuid not null references tasks(id) on delete cascade,
  day     date not null,
  primary key (task_id, day)
);

create table transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  client_id   text,
  type        text not null check (type in ('expense', 'income', 'saving')),
  description text not null check (length(description) between 1 and 200),
  category    text not null check (length(category) between 1 and 60),
  amount      numeric(12,2) not null check (amount > 0),   -- numeric evita erros de ponto flutuante
  date        date not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, client_id)
);
create index transactions_user_date_idx on transactions (user_id, date);

create table financial_goals (
  user_id    uuid primary key references users(id) on delete cascade,
  name       text not null default '',
  amount     numeric(12,2) not null check (amount > 0),
  deadline   text not null check (deadline ~ '^\d{4}-(0[1-9]|1[0-2])$'),  -- AAAA-MM
  updated_at timestamptz not null default now()
);
