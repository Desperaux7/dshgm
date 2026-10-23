-- 005: tarefas "em andamento" (por dia, como a conclusão) e categorias próprias das movimentações.

-- Dia em que a tarefa está em andamento. Segue a mesma lógica de task_completions: recorrentes têm um estado
-- por dia. Um dia nunca está ao mesmo tempo em andamento e concluído (o repositório garante isso).
create table task_progress (
  task_id uuid not null references tasks(id) on delete cascade,
  day     date not null,
  primary key (task_id, day)
);

-- Categorias criadas pelo usuário (as padrão continuam no código). As movimentações guardam só o nome da
-- categoria, então apagar uma categoria daqui não altera nem apaga movimentações já registradas.
create table transaction_categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  type       text not null check (type in ('expense', 'income', 'saving')),
  name       text not null check (length(name) between 1 and 40),
  created_at timestamptz not null default now()
);
create unique index transaction_categories_unica on transaction_categories (user_id, type, lower(name));
