-- 010: módulo Times (modo profissional): times, subtimes e colaboradores.
--
-- Pontos fortes, pontos de melhoria (com evidência obrigatória e marca "desenvolvido") e últimos eventos
-- ficam em colunas jsonb do colaborador: são sempre lidos e gravados junto com o cartão dele, e a validação
-- de cada item (evidência, limites, tipos) é feita pela API.
create table teams (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  name       text not null check (length(name) between 1 and 80),
  sector     text not null default '' check (length(sector) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index teams_user_idx on teams (user_id);

create table team_subteams (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references teams(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  name       text not null check (length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index team_subteams_nome_unico on team_subteams (team_id, lower(name));

-- Excluir um subtime não exclui as pessoas: elas continuam no time, sem subtime.
create table team_members (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  team_id      uuid not null references teams(id) on delete cascade,
  subteam_id   uuid references team_subteams(id) on delete set null,
  name         text not null check (length(name) between 1 and 100),
  role         text not null default '' check (length(role) <= 100),
  strengths    jsonb not null default '[]'::jsonb check (jsonb_typeof(strengths) = 'array'),
  improvements jsonb not null default '[]'::jsonb check (jsonb_typeof(improvements) = 'array'),
  events       jsonb not null default '[]'::jsonb check (jsonb_typeof(events) = 'array'),
  profile      text not null default '' check (length(profile) <= 4000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index team_members_team_idx on team_members (team_id);
create index team_members_user_idx on team_members (user_id);
