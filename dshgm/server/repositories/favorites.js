import { atualizarCampos } from './sql.js'

export const CATEGORIA_PADRAO = 'Dia a dia'
export const CATEGORIAS_FIXAS = ['Estudos', 'Desenvolvimento', 'Dia a dia', 'Games']

const SELECT = `select id, name, url, category, pinned, folder_id, bar,
                       (extract(epoch from created_at) * 1000)::bigint::text as criado from favorites`

const mapear = (r) => ({
  id: r.id,
  nome: r.name,
  url: r.url,
  categoria: r.category,
  fixado: r.pinned,
  pastaId: r.folder_id ?? null,
  barra: r.bar,
  criado: Number(r.criado)
})

const SELECT_PASTA = `select id, name, bar, (extract(epoch from created_at) * 1000)::bigint::text as criado from favorite_folders`
const mapearPasta = (r) => ({ id: r.id, nome: r.name, barra: r.bar, criado: Number(r.criado) })

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
        'insert into favorites (user_id, name, url, category, pinned, folder_id, bar) values ($1, $2, $3, $4, $5, $6, $7) returning id',
        [userId, f.nome, f.url, f.categoria, f.fixado, f.pastaId ?? null, f.barra ?? 'central']
      )
      return this.obter(userId, id)
    },
    async atualizar(userId, id, c) {
      const mapa = {}
      if ('nome' in c) mapa.name = [c.nome]
      if ('url' in c) mapa.url = [c.url]
      if ('categoria' in c) mapa.category = [c.categoria]
      if ('fixado' in c) mapa.pinned = [c.fixado]
      if ('pastaId' in c) mapa.folder_id = [c.pastaId, 'uuid']
      if ('barra' in c) mapa.bar = [c.barra]
      const ok = await atualizarCampos(db, 'favorites', userId, id, mapa)
      return ok ? this.obter(userId, id) : null
    },
    async excluir(userId, id) {
      const r = await db.query('delete from favorites where id = $1 and user_id = $2 returning id', [id, userId])
      return r.length > 0
    },

    /* ---------- Categorias ---------- */
    // As quatro padrão são fixas. As demais existem só como o nome gravado nos favoritos.
    async renomearCategoria(userId, de, para) {
      const r = await db.query(
        'update favorites set category = $3, updated_at = now() where user_id = $1 and category = $2 returning id',
        [userId, de, para]
      )
      return r.length
    },
    // Os links da categoria excluída NÃO são apagados: passam para a categoria padrão "Dia a dia".
    async excluirCategoria(userId, nome) {
      const r = await db.query(
        'update favorites set category = $3, updated_at = now() where user_id = $1 and category = $2 returning id',
        [userId, nome, CATEGORIA_PADRAO]
      )
      return r.length
    },

    /* ---------- Pastas ---------- */
    async listarPastas(userId) {
      const l = await db.query(`${SELECT_PASTA} where user_id = $1 order by created_at, id`, [userId])
      return l.map(mapearPasta)
    },
    async obterPasta(userId, id) {
      const [r] = await db.query(`${SELECT_PASTA} where user_id = $1 and id = $2`, [userId, id])
      return r ? mapearPasta(r) : null
    },
    async contarPastas(userId) {
      const [r] = await db.query('select count(*)::int as n from favorite_folders where user_id = $1', [userId])
      return r.n
    },
    async nomeDePastaEmUso(userId, nome, ignorarId = null) {
      const l = await db.query(
        'select id from favorite_folders where user_id = $1 and lower(name) = lower($2) and ($3::uuid is null or id <> $3::uuid)',
        [userId, nome, ignorarId]
      )
      return l.length > 0
    },
    async criarPasta(userId, { nome, barra }) {
      const [{ id }] = await db.query(
        'insert into favorite_folders (user_id, name, bar) values ($1, $2, $3) returning id',
        [userId, nome, barra]
      )
      return this.obterPasta(userId, id)
    },
    // Mudar a barra da pasta leva os links dela junto (eles sempre seguem a barra da pasta).
    async atualizarPasta(userId, id, c) {
      const mapa = {}
      if ('nome' in c) mapa.name = [c.nome]
      if ('barra' in c) mapa.bar = [c.barra]
      const ok = await atualizarCampos(db, 'favorite_folders', userId, id, mapa)
      if (!ok) return null
      if ('barra' in c) {
        await db.query('update favorites set bar = $3, updated_at = now() where user_id = $1 and folder_id = $2', [userId, id, c.barra])
      }
      return this.obterPasta(userId, id)
    },
    // Os links da pasta excluída ficam soltos (folder_id vira nulo pela chave estrangeira) e mantêm a barra.
    async excluirPasta(userId, id) {
      const r = await db.query('delete from favorite_folders where id = $1 and user_id = $2 returning id', [id, userId])
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
