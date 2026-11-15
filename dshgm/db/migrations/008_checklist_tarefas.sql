-- 008: checklist dentro das tarefas.
--
-- Cada tarefa pode ter itens. O preenchimento é guardado POR DIA (como a conclusão da tarefa), para que uma
-- tarefa recorrente comece sem itens marcados a cada dia. Quando todos os itens de um dia estão marcados, o
-- servidor conclui a tarefa naquele dia (a regra fica na rota, em server/lib/checklist.js).
create table task_checklist_items (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references tasks(id) on delete cascade,
  text       text not null check (length(text) between 1 and 200),
  position   integer not null default 0,
  created_at timestamptz not null default now()
);
create index task_checklist_items_task_idx on task_checklist_items (task_id, position);

create table task_checklist_done (
  item_id uuid not null references task_checklist_items(id) on delete cascade,
  day     date not null,
  primary key (item_id, day)
);
