import { atualizarCampos } from './sql.js'

const SELECT = `select id, kind, title, platform, status, progress, cover_width, cover_height, cover_version,
                       (extract(epoch from created_at) * 1000)::bigint::text as criado,
                       (extract(epoch from updated_at) * 1000)::bigint::text as atualizado
                  from leisure_items`

const mapear = (r) => ({
  id: r.id,
  tipo: r.kind,
  titulo: r.title,
  plataforma: r.platform,
  status: r.status,
  progresso: r.progress,
  capa: r.cover_width ? { largura: r.cover_width, altura: r.cover_height, versao: r.cover_version } : null,
  criado: Number(r.criado),
  atualizado: Number(r.atualizado)
})

export function criarRepoLazer(db) {
  return {
    async listar(userId, limite = 2000) {
      const l = await db.query(`${SELECT} where user_id = $1 order by created_at, id limit $2`, [userId, limite])
      return l.map(mapear)
    },
    async obter(userId, id) {
      const [r] = await db.query(`${SELECT} where user_id = $1 and id = $2`, [userId, id])
      return r ? mapear(r) : null
    },
    async criar(userId, i) {
      const [{ id }] = await db.query(
        `insert into leisure_items (user_id, kind, title, platform, status, progress)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [userId, i.tipo, i.titulo, i.plataforma, i.status, i.progresso]
      )
      return this.obter(userId, id)
    },
    async atualizar(userId, id, c) {
      const mapa = {}
      if ('tipo' in c) mapa.kind = [c.tipo]
      if ('titulo' in c) mapa.title = [c.titulo]
      if ('plataforma' in c) mapa.platform = [c.plataforma]
      if ('status' in c) mapa.status = [c.status]
      if ('progresso' in c) mapa.progress = [c.progresso]
      const ok = await atualizarCampos(db, 'leisure_items', userId, id, mapa)
      return ok ? this.obter(userId, id) : null
    },
    async excluir(userId, id) {
      const r = await db.query('delete from leisure_items where id = $1 and user_id = $2 returning id', [id, userId])
      return r.length > 0
    },
    async salvarCapa(userId, id, { mime, base64, largura, altura }) {
      const dono = await db.query('select 1 from leisure_items where id = $1 and user_id = $2', [id, userId])
      if (!dono.length) return null
      await db.query(
        `insert into leisure_covers (item_id, user_id, mime, data_base64) values ($1, $2, $3, $4)
         on conflict (item_id) do update set mime = excluded.mime, data_base64 = excluded.data_base64, updated_at = now()`,
        [id, userId, mime, base64]
      )
      await db.query(
        `update leisure_items set cover_width = $3, cover_height = $4, cover_version = cover_version + 1, updated_at = now()
          where id = $1 and user_id = $2`,
        [id, userId, largura, altura]
      )
      return this.obter(userId, id)
    },
    async lerCapa(userId, id) {
      const [c] = await db.query(
        'select mime, data_base64 from leisure_covers where item_id = $1 and user_id = $2',
        [id, userId]
      )
      return c ? { mime: c.mime, buffer: Buffer.from(c.data_base64, 'base64') } : null
    },
    async removerCapa(userId, id) {
      const dono = await db.query('select 1 from leisure_items where id = $1 and user_id = $2', [id, userId])
      if (!dono.length) return null
      await db.query('delete from leisure_covers where item_id = $1 and user_id = $2', [id, userId])
      await db.query(
        `update leisure_items set cover_width = null, cover_height = null, cover_version = cover_version + 1, updated_at = now()
          where id = $1 and user_id = $2`,
        [id, userId]
      )
      return this.obter(userId, id)
    },
    // Retorna também o mapa client_id -> id novo, para o navegador enviar as capas do IndexedDB.
    async importar(userId, lote) {
      if (!lote.length) return { recebidos: 0, importados: 0, mapa: {} }
      const linhas = await db.query(
        `with entrada as (
           select * from jsonb_to_recordset($2::jsonb)
             as t(client_id text, tipo text, titulo text, plataforma text, status text, progresso int,
                  criado double precision, atualizado double precision)
         ),
         novos as (
           insert into leisure_items (user_id, client_id, kind, title, platform, status, progress, created_at, updated_at)
           select $1::uuid, client_id, tipo, titulo, plataforma, status, progresso,
                  to_timestamp(coalesce(criado, extract(epoch from now()) * 1000) / 1000.0),
                  to_timestamp(coalesce(atualizado, criado, extract(epoch from now()) * 1000) / 1000.0)
             from entrada
           on conflict (user_id, client_id) do nothing
           returning id, client_id
         )
         select (select count(*) from entrada)::int as recebidos, novos.id, novos.client_id
           from (select 1) x left join novos on true`,
        [userId, JSON.stringify(lote)]
      )
      const mapa = {}
      for (const l of linhas) if (l.id) mapa[l.client_id] = l.id
      const itens = await db.query(
        'select id, client_id from leisure_items where user_id = $1 and client_id = any($2::text[])',
        [userId, lote.map((i) => i.client_id)]
      )
      // mapa completo (inclui itens que já existiam), útil para repetir a importação de capas
      const completo = Object.fromEntries(itens.map((i) => [i.client_id, i.id]))
      return { recebidos: linhas[0]?.recebidos ?? lote.length, importados: Object.keys(mapa).length, mapa: completo }
    }
  }
}
