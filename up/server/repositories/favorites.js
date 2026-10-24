import { atualizarCampos } from './sql.js'

const SELECT = `select id, name, url, category, pinned,
                       (extract(epoch from created_at) * 1000)::bigint::text as criado from favorites`

const mapear = (r) => ({
  id: r.id,
  nome: r.name,
  url: r.url,
  categoria: r.category,
  fixado: r.pinned,
  criado: Number(r.criado)
})

export function criarRepoFavoritos(db) {
  return {
    async listar(userId, limite = 1000) {
      const l = await db.query(`${SELECT} where user_id = $1 order by created_at, id limit $2`, [userId, limite])
      return l.map(mapear)
    },
    async obter(userId, id) {
      const [r] = await db.query(`${SELECT} where user_id = $1 and id = $2`, [userId, id])
      return r ? mapear(r) : null
    },
    async contar(userId) {
      const [r] = await db.query('select count(*)::int as n from favorites where user_id = $1', [userId])
      return r.n
    },
    async criar(userId, f) {
      const [{ id }] = await db.query(
        'insert into favorites (user_id, name, url, category, pinned) values ($1, $2, $3, $4, $5) returning id',
        [userId, f.nome, f.url, f.categoria, f.fixado]
      )
      return this.obter(userId, id)
    },
    async atualizar(userId, id, c) {
      const mapa = {}
      if ('nome' in c) mapa.name = [c.nome]
      if ('url' in c) mapa.url = [c.url]
      if ('categoria' in c) mapa.category = [c.categoria]
      if ('fixado' in c) mapa.pinned = [c.fixado]
      const ok = await atualizarCampos(db, 'favorites', userId, id, mapa)
      return ok ? this.obter(userId, id) : null
    },
    async excluir(userId, id) {
      const r = await db.query('delete from favorites where id = $1 and user_id = $2 returning id', [id, userId])
      return r.length > 0
    },
    async importar(userId, lote) {
      if (!lote.length) return { recebidos: 0, importados: 0 }
      const [r] = await db.query(
        `with entrada as (
           select * from jsonb_to_recordset($2::jsonb)
             as t(client_id text, nome text, url text, categoria text, fixado boolean, criado double precision)
         ),
         novos as (
           insert into favorites (user_id, client_id, name, url, category, pinned, created_at)
           select $1::uuid, client_id, nome, url, categoria, fixado,
                  to_timestamp(coalesce(criado, extract(epoch from now()) * 1000) / 1000.0)
             from entrada
           on conflict (user_id, client_id) do nothing
           returning 1
         )
         select (select count(*) from entrada)::int as recebidos, (select count(*) from novos)::int as importados`,
        [userId, JSON.stringify(lote)]
      )
      return r
    }
  }
}
