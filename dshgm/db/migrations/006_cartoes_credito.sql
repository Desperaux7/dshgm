-- 006: cartões de crédito (cartões, faturas, compras, parcelas e pagamentos de fatura).
--
-- Regra financeira: a compra é consumo (despesa) no mês de cada parcela; o fechamento só consolida a fatura;
-- o pagamento da fatura é saída de caixa e NÃO cria despesa. Por isso nada daqui entra em "transactions":
-- o consumo vem de card_installments e o caixa de card_payments, e cada valor existe uma única vez.
-- Nunca se guarda número do cartão, CVV ou credenciais: só nome, instituição, limite e dias.

create table credit_cards (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  name         text not null check (length(name) between 1 and 60),
  institution  text not null default '' check (length(institution) <= 60),
  credit_limit numeric(12,2) not null check (credit_limit > 0),
  closing_day  smallint not null check (closing_day between 1 and 31),
  due_day      smallint not null check (due_day between 1 and 31),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index credit_cards_user_idx on credit_cards (user_id);

-- Uma linha por ciclo de cada cartão. As datas ficam gravadas quando a fatura é criada: mudar o dia de
-- fechamento/vencimento do cartão vale para as próximas faturas, não reescreve as já existentes.
create table card_invoices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  card_id      uuid not null references credit_cards(id) on delete cascade,
  ref_month    text not null check (ref_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),  -- mês do fechamento
  period_start date not null,
  closing_date date not null,
  due_date     date not null,
  created_at   timestamptz not null default now(),
  unique (card_id, ref_month),
  check (period_start <= closing_date)
);
create index card_invoices_user_idx on card_invoices (user_id, closing_date);

create table card_purchases (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  card_id       uuid not null references credit_cards(id) on delete cascade,
  kind          text not null check (kind in ('purchase', 'refund', 'adjustment')),
  description   text not null check (length(description) between 1 and 200),
  category      text not null check (length(category) between 1 and 60),
  total_amount  numeric(12,2) not null check (total_amount <> 0),   -- com sinal: estorno/desconto é negativo
  installments  smallint not null default 1 check (installments between 1 and 48),
  purchase_date date not null,
  client_key    text check (client_key is null or length(client_key) between 8 and 80),  -- evita registro repetido
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check ((kind = 'purchase' and total_amount > 0) or (kind = 'refund' and total_amount < 0) or kind = 'adjustment'),
  check (kind = 'purchase' or installments = 1)
);
create index card_purchases_user_idx on card_purchases (user_id, purchase_date);
create unique index card_purchases_chave_idx on card_purchases (user_id, client_key) where client_key is not null;

create table card_installments (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  purchase_id     uuid not null references card_purchases(id) on delete cascade,
  card_id         uuid not null references credit_cards(id) on delete cascade,
  invoice_id      uuid not null references card_invoices(id) on delete cascade,
  number          smallint not null check (number >= 1),
  amount          numeric(12,2) not null check (amount <> 0),
  competence_date date not null,          -- mês em que a parcela conta como consumo
  -- Adiada: a edição troca todas as parcelas de uma compra numa única instrução.
  constraint card_installments_numero unique (purchase_id, number) deferrable initially deferred
);
create index card_installments_invoice_idx on card_installments (invoice_id);
create index card_installments_user_idx on card_installments (user_id, competence_date);

create table card_payments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  card_id    uuid not null references credit_cards(id) on delete cascade,
  invoice_id uuid not null references card_invoices(id) on delete cascade,
  amount     numeric(12,2) not null check (amount > 0),
  paid_on    date not null,
  client_key text check (client_key is null or length(client_key) between 8 and 80),
  created_at timestamptz not null default now()
);
create index card_payments_invoice_idx on card_payments (invoice_id);
create index card_payments_user_idx on card_payments (user_id, paid_on);
create unique index card_payments_chave_idx on card_payments (user_id, client_key) where client_key is not null;
