import { atualizarCampos } from './sql.js'

const SELECT = `select id, type, description, category, amount::text as amount, to_char(date, 'YYYY-MM-DD') as date from transactions`

const mapear = (r) => ({
  id: r.id,
  type: r.type,
  description: r.description,
  category: r.category,
  amount: Number(r.amount),
  date: r.date
})

export function criarRepoTransacoes(db) {
  return {
    async listar(userId, { de, ate, limite = 2000, offset = 0 } = {}) {
      const linhas = await db.query(
        `${SELECT} where user_id = $1
            and ($2::date is null or date >= $2::date)
            and ($3::date is null or date <= $3::date)
          order by date desc, created_at desc, id
          limit $4 offset $5`,
        [userId, de ?? null, ate ?? null, limite, offset]
      )
      return linhas.map(mapear)
    },
    async obter(userId, id) {
      const [r] = await db.query(`${SELECT} where user_id = $1 and id = $2`, [userId, id])
      return r ? mapear(r) : null
    },
    async criar(userId, t) {
      const [{ id }] = await db.query(
        `insert into transactions (user_id, type, description, category, amount, date)
         values ($1, $2, $3, $4, $5::numeric, $6::date) returning id`,
        [userId, t.type, t.description, t.category, t.amount, t.date]
      )
      return this.obter(userId, id)
    },
    async atualizar(userId, id, c) {
      const mapa = {}
      if ('type' in c) mapa.type = [c.type]
      if ('description' in c) mapa.description = [c.description]
      if ('category' in c) mapa.category = [c.category]
      if ('amount' in c) mapa.amount = [c.amount, 'numeric']
      if ('date' in c) mapa.date = [c.date, 'date']
      const ok = await atualizarCampos(db, 'transactions', userId, id, mapa)
      return ok ? this.obter(userId, id) : null
    },
    async excluir(userId, id) {
      const r = await db.query('delete from transactions where id = $1 and user_id = $2 returning id', [id, userId])
      return r.length > 0
    },
    // Saldo = entradas − despesas − guardado (mesma regra da tela Financeiro e do PDF).
    // Somas em numeric: exatas, sem erro de ponto flutuante.
    async resumo(userId, mes) {
      const [r] = await db.query(
        `select
           coalesce(sum(amount) filter (where type = 'income'  and to_char(date, 'YYYY-MM') = $2), 0)::text as entradas,
           coalesce(sum(amount) filter (where type = 'expense' and to_char(date, 'YYYY-MM') = $2), 0)::text as despesas,
           coalesce(sum(amount) filter (where type = 'saving'  and to_char(date, 'YYYY-MM') = $2), 0)::text as guardado,
           (coalesce(sum(amount) filter (where type = 'income'  and to_char(date, 'YYYY-MM') = $2), 0)
          - coalesce(sum(amount) filter (where type = 'expense' and to_char(date, 'YYYY-MM') = $2), 0)
          - coalesce(sum(amount) filter (where type = 'saving'  and to_char(date, 'YYYY-MM') = $2), 0))::text as saldo,
           coalesce(sum(amount) filter (where type = 'saving'), 0)::text as total_guardado
         from transactions where user_id = $1`,
        [userId, mes]
      )
      return {
        mes,
        entradas: Number(r.entradas),
        despesas: Number(r.despesas),
        guardado: Number(r.guardado),
        saldo: Number(r.saldo),
        totalGuardado: Number(r.total_guardado)
      }
    },
    async importar(userId, lote) {
      if (!lote.length) return { recebidos: 0, importados: 0 }
      const [r] = await db.query(
        `with entrada as (
           select * from jsonb_to_recordset($2::jsonb)
             as t(client_id text, type text, description text, category text, amount numeric, date date)
         ),
         novas as (
           insert into transactions (user_id, client_id, type, description, category, amount, date)
           select $1::uuid, client_id, type, description, category, amount, date from entrada
           on conflict (user_id, client_id) do nothing
           returning 1
         )
         select (select count(*) from entrada)::int as recebidos, (select count(*) from novas)::int as importados`,
        [userId, JSON.stringify(lote)]
      )
      return r
    },
    async listarCategorias(userId) {
      const l = await db.query(
        'select id, type, name from transaction_categories where user_id = $1 order by lower(name), id',
        [userId]
      )
      return l.map((c) => ({ id: c.id, tipo: c.type, nome: c.name }))
    },
    async contarCategorias(userId) {
      const [r] = await db.query('select count(*)::int as n from transaction_categories where user_id = $1', [userId])
      return r.n
    },
    // Idempotente: pedir uma categoria que já existe (sem diferenciar maiúsculas) devolve a existente.
    async criarCategoria(userId, { tipo, nome }) {
      await db.query(
        `insert into transaction_categories (user_id, type, name) values ($1, $2, $3)
         on conflict (user_id, type, lower(name)) do nothing`,
        [userId, tipo, nome]
      )
      const [c] = await db.query(
        'select id, type, name from transaction_categories where user_id = $1 and type = $2 and lower(name) = lower($3)',
        [userId, tipo, nome]
      )
      return { id: c.id, tipo: c.type, nome: c.name }
    },
    async removerCategoria(userId, id) {
      const r = await db.query('delete from transaction_categories where id = $1 and user_id = $2 returning id', [id, userId])
      return r.length > 0
    },
    async obterMeta(userId) {
      const [m] = await db.query(
        `select name as nome, amount::text as valor, deadline as prazo from financial_goals where user_id = $1`,
        [userId]
      )
      return m ? { nome: m.nome, valor: Number(m.valor), prazo: m.prazo } : null
    },
    async salvarMeta(userId, m) {
      await db.query(
        `insert into financial_goals (user_id, name, amount, deadline) values ($1, $2, $3::numeric, $4)
         on conflict (user_id) do update set name = excluded.name, amount = excluded.amount,
                                             deadline = excluded.deadline, updated_at = now()`,
        [userId, m.nome, m.valor, m.prazo]
      )
      return m
    },
    // Importa a meta só se ainda não houver uma (nunca sobrescreve dados do servidor).
    async importarMeta(userId, m) {
      const r = await db.query(
        `insert into financial_goals (user_id, name, amount, deadline) values ($1, $2, $3::numeric, $4)
         on conflict (user_id) do nothing returning user_id`,
        [userId, m.nome, m.valor, m.prazo]
      )
      return r.length > 0
    },
    async removerMeta(userId) {
      await db.query('delete from financial_goals where user_id = $1', [userId])
    }
  }
}
