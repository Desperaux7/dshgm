import { atualizarCampos } from './sql.js'

const n = (x) => Number(x)

const mapearCartao = (r) => ({
  id: r.id,
  nome: r.name,
  instituicao: r.institution,
  limite: n(r.credit_limit),
  diaFechamento: r.closing_day,
  diaVencimento: r.due_day,
  ativo: r.active,
  // Limite comprometido = tudo que foi lançado (inclusive parcelas futuras) menos o que já foi pago.
  usado: n(r.lancado) - n(r.pago),
  disponivel: n(r.credit_limit) - (n(r.lancado) - n(r.pago))
})

const SELECT_CARTAO = `
  select c.id, c.name, c.institution, c.credit_limit::text as credit_limit, c.closing_day, c.due_day, c.active,
         coalesce((select sum(i.amount) from card_installments i where i.card_id = c.id), 0)::text as lancado,
         coalesce((select sum(p.amount) from card_payments p where p.card_id = c.id), 0)::text as pago
    from credit_cards c`

const SELECT_FATURA = `
  select f.id, f.card_id, c.name as card_name, f.ref_month,
         to_char(f.period_start, 'YYYY-MM-DD') as period_start,
         to_char(f.closing_date, 'YYYY-MM-DD') as closing_date,
         to_char(f.due_date, 'YYYY-MM-DD') as due_date,
         coalesce((select sum(i.amount) from card_installments i where i.invoice_id = f.id), 0)::text as total,
         coalesce((select sum(p.amount) from card_payments p where p.invoice_id = f.id), 0)::text as pago
    from card_invoices f join credit_cards c on c.id = f.card_id`

export const mapearFatura = (r) => ({
  id: r.id,
  cartaoId: r.card_id,
  cartaoNome: r.card_name,
  mesRef: r.ref_month,
  inicio: r.period_start,
  fechamento: r.closing_date,
  vencimento: r.due_date,
  total: n(r.total),
  pago: n(r.pago),
  pendente: Math.round((n(r.total) - n(r.pago)) * 100) / 100
})

const SELECT_LANCAMENTO = `
  select i.id, i.number, i.amount::text as amount, to_char(i.competence_date, 'YYYY-MM-DD') as competence_date,
         p.id as purchase_id, p.kind, p.description, p.category, p.installments, p.total_amount::text as total_amount,
         to_char(p.purchase_date, 'YYYY-MM-DD') as purchase_date,
         c.id as card_id, c.name as card_name,
         f.id as invoice_id, f.ref_month,
         to_char(f.closing_date, 'YYYY-MM-DD') as closing_date, to_char(f.due_date, 'YYYY-MM-DD') as due_date,
         (select coalesce(sum(x.amount), 0) from card_installments x where x.invoice_id = f.id)::text as fat_total,
         (select coalesce(sum(y.amount), 0) from card_payments y where y.invoice_id = f.id)::text as fat_pago
    from card_installments i
    join card_purchases p on p.id = i.purchase_id
    join credit_cards c on c.id = i.card_id
    join card_invoices f on f.id = i.invoice_id`

export const mapearLancamento = (r) => ({
  id: r.id,
  compraId: r.purchase_id,
  tipo: r.kind === 'purchase' ? 'compra' : r.kind === 'refund' ? 'estorno' : 'ajuste',
  descricao: r.description,
  categoria: r.category,
  numero: r.number,
  parcelas: r.installments,
  valor: n(r.amount),
  valorTotal: n(r.total_amount),
  competencia: r.competence_date,
  dataCompra: r.purchase_date,
  cartaoId: r.card_id,
  cartaoNome: r.card_name,
  faturaId: r.invoice_id,
  faturaMes: r.ref_month,
  fechamento: r.closing_date,
  vencimento: r.due_date,
  faturaTotal: n(r.fat_total),
  faturaPago: n(r.fat_pago)
})

export function criarRepoCartoes(db) {
  return {
    /* ---------- Cartões ---------- */
    async listarCartoes(userId) {
      const l = await db.query(`${SELECT_CARTAO} where c.user_id = $1 order by c.active desc, lower(c.name), c.id`, [userId])
      return l.map(mapearCartao)
    },
    // Cartão com a configuração usada nos cálculos de ciclo (inclui inativos).
    async obterCartao(userId, id) {
      const [r] = await db.query(`${SELECT_CARTAO} where c.user_id = $1 and c.id = $2`, [userId, id])
      return r ? mapearCartao(r) : null
    },
    async contarCartoes(userId) {
      const [r] = await db.query('select count(*)::int as n from credit_cards where user_id = $1', [userId])
      return r.n
    },
    async criarCartao(userId, c) {
      const [{ id }] = await db.query(
        `insert into credit_cards (user_id, name, institution, credit_limit, closing_day, due_day)
         values ($1, $2, $3, $4::numeric, $5, $6) returning id`,
        [userId, c.nome, c.instituicao, c.limite, c.diaFechamento, c.diaVencimento]
      )
      return this.obterCartao(userId, id)
    },
    async atualizarCartao(userId, id, c) {
      const mapa = {}
      if ('nome' in c) mapa.name = [c.nome]
      if ('instituicao' in c) mapa.institution = [c.instituicao]
      if ('limite' in c) mapa.credit_limit = [c.limite, 'numeric']
      if ('diaFechamento' in c) mapa.closing_day = [c.diaFechamento]
      if ('diaVencimento' in c) mapa.due_day = [c.diaVencimento]
      if ('ativo' in c) mapa.active = [c.ativo]
      const ok = await atualizarCampos(db, 'credit_cards', userId, id, mapa)
      return ok ? this.obterCartao(userId, id) : null
    },

    /* ---------- Faturas ---------- */
    // Faturas com total e valor pago calculados no banco (numeric, sem erro de ponto flutuante).
    // `ate`/`de` filtram pela data de fechamento. `relevantesDesde`: só as pendentes ou que ainda não fecharam.
    async listarFaturas(userId, { cartaoId, de, ate, relevantesDesde } = {}) {
      const l = await db.query(
        `select * from (${SELECT_FATURA} where f.user_id = $1
            and ($2::uuid is null or f.card_id = $2)
            and ($3::date is null or f.closing_date >= $3::date)
            and ($4::date is null or f.closing_date <= $4::date)) q
          where $5::date is null or q.closing_date >= to_char($5::date, 'YYYY-MM-DD') or q.total::numeric <> q.pago::numeric
          order by q.due_date desc, q.card_name, q.id
          limit 500`,
        [userId, cartaoId ?? null, de ?? null, ate ?? null, relevantesDesde ?? null]
      )
      return l.map(mapearFatura)
    },
    async obterFatura(userId, id) {
      const [r] = await db.query(`${SELECT_FATURA} where f.user_id = $1 and f.id = $2`, [userId, id])
      return r ? mapearFatura(r) : null
    },
    async pagamentosDaFatura(userId, faturaId) {
      const l = await db.query(
        `select id, amount::text as amount, to_char(paid_on, 'YYYY-MM-DD') as paid_on
           from card_payments where user_id = $1 and invoice_id = $2 order by paid_on, created_at, id`,
        [userId, faturaId]
      )
      return l.map((p) => ({ id: p.id, valor: n(p.amount), data: p.paid_on }))
    },
    async lancamentosDaFatura(userId, faturaId) {
      const l = await db.query(
        `${SELECT_LANCAMENTO} where i.user_id = $1 and i.invoice_id = $2 order by p.purchase_date, p.created_at, i.number`,
        [userId, faturaId]
      )
      return l.map(mapearLancamento)
    },
    async pagoNoMes(userId, mes) {
      const [r] = await db.query(
        `select coalesce(sum(amount), 0)::text as total from card_payments
          where user_id = $1 and to_char(paid_on, 'YYYY-MM') = $2`,
        [userId, mes]
      )
      return n(r.total)
    },

    /* ---------- Lançamentos (parcelas) ---------- */
    async listarLancamentos(userId, { cartaoId, de, ate, limite = 1000 } = {}) {
      const l = await db.query(
        `${SELECT_LANCAMENTO} where i.user_id = $1
            and ($2::uuid is null or i.card_id = $2)
            and ($3::date is null or i.competence_date >= $3::date)
            and ($4::date is null or i.competence_date <= $4::date)
          order by i.competence_date desc, p.created_at desc, i.number
          limit $5`,
        [userId, cartaoId ?? null, de ?? null, ate ?? null, limite]
      )
      return l.map(mapearLancamento)
    },
    // Consumo do cartão no formato das movimentações do Financeiro (despesa no mês de cada parcela).
    async consumo(userId, { de, ate } = {}) {
      const l = await db.query(
        `select i.id, i.amount::text as amount, to_char(i.competence_date, 'YYYY-MM-DD') as competence_date,
                i.number, p.id as purchase_id, p.description, p.category, p.installments, p.kind,
                c.id as card_id, c.name as card_name
           from card_installments i
           join card_purchases p on p.id = i.purchase_id
           join credit_cards c on c.id = i.card_id
          where i.user_id = $1
            and ($2::date is null or i.competence_date >= $2::date)
            and ($3::date is null or i.competence_date <= $3::date)
          order by i.competence_date desc, p.created_at desc, i.number
          limit 5000`,
        [userId, de ?? null, ate ?? null]
      )
      return l.map((r) => ({
        id: `cartao:${r.id}`,
        type: 'expense',
        description: r.installments > 1 ? `${r.description} (${r.number}/${r.installments})` : r.description,
        category: r.category,
        amount: n(r.amount),
        date: r.competence_date,
        origem: 'cartao',
        cartaoId: r.card_id,
        cartaoNome: r.card_name,
        compraId: r.purchase_id,
        tipoCompra: r.kind === 'purchase' ? 'compra' : r.kind === 'refund' ? 'estorno' : 'ajuste'
      }))
    },

    /* ---------- Compras ---------- */
    async obterCompra(userId, id) {
      const [r] = await db.query(
        `select id, card_id, kind, description, category, total_amount::text as total_amount, installments,
                to_char(purchase_date, 'YYYY-MM-DD') as purchase_date, client_key
           from card_purchases where user_id = $1 and id = $2`,
        [userId, id]
      )
      return r ?? null
    },
    async compraPorChave(userId, chave) {
      const [r] = await db.query('select id from card_purchases where user_id = $1 and client_key = $2', [userId, chave])
      return r?.id ?? null
    },
    // Compras que já têm pagamento em alguma das faturas delas não podem ser alteradas nem apagadas.
    async compraTemPagamentos(userId, id) {
      const [r] = await db.query(
        `select exists (select 1 from card_installments i join card_payments p on p.invoice_id = i.invoice_id
                         where i.purchase_id = $1 and i.user_id = $2) as sim`,
        [id, userId]
      )
      return r.sim
    },
    // Cria a compra, as faturas que ainda não existem e todas as parcelas numa única instrução (tudo ou nada).
    // `criada` = 0 quando o cartão não é do usuário/está inativo, a chave já existia ou faltou criar alguma fatura.
    async criarCompra(userId, c) {
      const [r] = await db.query(
        `with dono as (select id from credit_cards where id = $1 and user_id = $2 and active),
              ciclos as (select * from jsonb_to_recordset($3::jsonb)
                           as x(ref_month text, period_start date, closing_date date, due_date date)),
              novas as (
                insert into card_invoices (user_id, card_id, ref_month, period_start, closing_date, due_date)
                select $2, $1, x.ref_month, x.period_start, x.closing_date, x.due_date
                  from ciclos x where exists (select 1 from dono)
                on conflict (card_id, ref_month) do nothing
                returning id, ref_month),
              faturas as (
                select id, ref_month from novas
                union all
                select f.id, f.ref_month from card_invoices f
                 where f.card_id = $1 and f.user_id = $2 and f.ref_month in (select ref_month from ciclos)),
              compra as (
                insert into card_purchases (id, user_id, card_id, kind, description, category, total_amount,
                                            installments, purchase_date, client_key)
                select $4::uuid, $2, $1, $5, $6, $7, $8::numeric, $9, $10::date, $11
                 where exists (select 1 from dono)
                   and (select count(*) from faturas) = (select count(*) from ciclos)
                on conflict (user_id, client_key) where client_key is not null do nothing
                returning id),
              parcelas as (
                insert into card_installments (user_id, purchase_id, card_id, invoice_id, number, amount, competence_date)
                select $2, $4::uuid, $1, f.id, p.numero, p.valor, p.competencia
                  from jsonb_to_recordset($12::jsonb) as p(numero int, valor numeric, competencia date, ref_month text)
                  join faturas f on f.ref_month = p.ref_month
                 where exists (select 1 from compra)
                returning 1)
         select (select count(*) from compra)::int as criada, (select count(*) from parcelas)::int as parcelas`,
        [
          c.cartaoId, userId, JSON.stringify(c.ciclos), c.id, c.kind, c.descricao, c.categoria,
          c.total, c.parcelas, c.data, c.chave ?? null, JSON.stringify(c.itens)
        ]
      )
      return r
    },
    async atualizarTextoDaCompra(userId, id, { descricao, categoria }) {
      const mapa = {}
      if (descricao !== undefined) mapa.description = [descricao]
      if (categoria !== undefined) mapa.category = [categoria]
      return atualizarCampos(db, 'card_purchases', userId, id, mapa)
    },
    // Troca valor/parcelas/data/cartão: refaz TODAS as parcelas na mesma instrução e só procede se nenhuma
    // fatura envolvida (antiga ou nova) tiver pagamento.
    async refazerCompra(userId, c) {
      const [r] = await db.query(
        `with dono as (select id from credit_cards where id = $1 and user_id = $2 and active),
              compra as (select id from card_purchases where id = $4::uuid and user_id = $2),
              ciclos as (select * from jsonb_to_recordset($3::jsonb)
                           as x(ref_month text, period_start date, closing_date date, due_date date)),
              bloqueio as (
                select 1 from card_payments p
                 where p.user_id = $2
                   and (p.invoice_id in (select invoice_id from card_installments where purchase_id = $4::uuid)
                        or p.invoice_id in (select f.id from card_invoices f
                                             where f.card_id = $1 and f.ref_month in (select ref_month from ciclos)))),
              liberado as (select 1 where exists (select 1 from dono) and exists (select 1 from compra)
                                      and not exists (select 1 from bloqueio)),
              novas as (
                insert into card_invoices (user_id, card_id, ref_month, period_start, closing_date, due_date)
                select $2, $1, x.ref_month, x.period_start, x.closing_date, x.due_date
                  from ciclos x where exists (select 1 from liberado)
                on conflict (card_id, ref_month) do nothing
                returning id, ref_month),
              faturas as (
                select id, ref_month from novas
                union all
                select f.id, f.ref_month from card_invoices f
                 where f.card_id = $1 and f.user_id = $2 and f.ref_month in (select ref_month from ciclos)),
              pronto as (select 1 where exists (select 1 from liberado)
                                    and (select count(*) from faturas) = (select count(*) from ciclos)),
              antigas as (delete from card_installments where purchase_id = $4::uuid and exists (select 1 from pronto) returning 1),
              atualizada as (
                update card_purchases set card_id = $1, kind = $5, description = $6, category = $7,
                       total_amount = $8::numeric, installments = $9, purchase_date = $10::date, updated_at = now()
                 where id = $4::uuid and user_id = $2 and exists (select 1 from pronto)
                returning id),
              parcelas as (
                insert into card_installments (user_id, purchase_id, card_id, invoice_id, number, amount, competence_date)
                select $2, $4::uuid, $1, f.id, p.numero, p.valor, p.competencia
                  from jsonb_to_recordset($11::jsonb) as p(numero int, valor numeric, competencia date, ref_month text)
                  join faturas f on f.ref_month = p.ref_month
                 where exists (select 1 from atualizada)
                returning 1)
         select (select count(*) from atualizada)::int as atualizada,
                (select count(*) from parcelas)::int as parcelas,
                exists (select 1 from bloqueio) as bloqueada`,
        [c.cartaoId, userId, JSON.stringify(c.ciclos), c.id, c.kind, c.descricao, c.categoria, c.total, c.parcelas, c.data, JSON.stringify(c.itens)]
      )
      return r
    },
    async excluirCompra(userId, id) {
      const r = await db.query(
        `delete from card_purchases where id = $1 and user_id = $2
            and not exists (select 1 from card_installments i join card_payments p on p.invoice_id = i.invoice_id
                             where i.purchase_id = $1)
          returning id`,
        [id, userId]
      )
      return r.length > 0
    },

    /* ---------- Pagamentos ---------- */
    // Grava o pagamento só se o valor couber no saldo pendente da fatura e a chave ainda não tiver sido usada.
    async registrarPagamento(userId, { faturaId, valor, data, chave }) {
      const [r] = await db.query(
        `with fat as (
           select f.id, f.card_id,
                  (select coalesce(sum(i.amount), 0) from card_installments i where i.invoice_id = f.id) as total,
                  (select coalesce(sum(p.amount), 0) from card_payments p where p.invoice_id = f.id) as pago
             from card_invoices f where f.id = $1 and f.user_id = $2),
         nova as (
           insert into card_payments (user_id, card_id, invoice_id, amount, paid_on, client_key)
           select $2, card_id, id, $3::numeric, $4::date, $5 from fat where $3::numeric <= total - pago
           on conflict (user_id, client_key) where client_key is not null do nothing
           returning id)
         select (select count(*) from fat)::int as existe, (select id from nova) as id`,
        [faturaId, userId, valor, data, chave ?? null]
      )
      return r
    },
    async pagamentoPorChave(userId, chave) {
      const [r] = await db.query('select id, invoice_id from card_payments where user_id = $1 and client_key = $2', [userId, chave])
      return r ?? null
    },
    async excluirPagamento(userId, id) {
      const r = await db.query('delete from card_payments where id = $1 and user_id = $2 returning id', [id, userId])
      return r.length > 0
    }
  }
}
