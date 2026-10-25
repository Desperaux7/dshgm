const SELECT = `select id, name, description, link_url, image_url, price::text as price, priority, status,
                       (extract(epoch from purchased_at) * 1000)::bigint::text as purchased,
                       (extract(epoch from created_at) * 1000)::bigint::text as created
                  from wishlist_items`

const mapear = (r) => ({
  id: r.id,
  nome: r.name,
  descricao: r.description,
  linkUrl: r.link_url,
  imagemUrl: r.image_url,
  preco: Number(r.price),
  prioridade: r.priority,
  status: r.status,
  compradoEm: r.purchased ? Number(r.purchased) : null,
  criadoEm: Number(r.created)
})

// Alta, média, baixa; dentro de cada prioridade, os desejados antes dos comprados e os mais novos primeiro.
const ORDEM = `order by case priority when 'alta' then 1 when 'media' then 2 else 3 end,
                        case status when 'desejado' then 1 else 2 end, created_at desc, id`

export function criarRepoDesejos(db) {
  return {
    async listar(userId, limite = 1000) {
      const l = await db.query(`${SELECT} where user_id = $1 ${ORDEM} limit $2`, [userId, limite])
      return l.map(mapear)
    },
    async obter(userId, id) {
      const [r] = await db.query(`${SELECT} where user_id = $1 and id = $2`, [userId, id])
      return r ? mapear(r) : null
    },
    async contar(userId) {
      const [r] = await db.query('select count(*)::int as n from wishlist_items where user_id = $1', [userId])
      return r.n
    },
    // Totais sempre calculados no banco, a partir dos registros gravados (numeric: sem erro de ponto flutuante).
    async totais(userId) {
      const [r] = await db.query(
        `select count(*)::int as quantidade,
                count(*) filter (where status = 'desejado')::int as desejados,
                count(*) filter (where status = 'comprado')::int as comprados,
                coalesce(sum(price) filter (where status = 'desejado'), 0)::text as valor_desejado,
                coalesce(sum(price) filter (where status = 'comprado'), 0)::text as valor_comprado,
                coalesce(sum(price), 0)::text as valor_total
           from wishlist_items where user_id = $1`,
        [userId]
      )
      return {
        quantidade: r.quantidade,
        desejados: r.desejados,
        comprados: r.comprados,
        valorDesejado: Number(r.valor_desejado),
        valorComprado: Number(r.valor_comprado),
        valorTotal: Number(r.valor_total)
      }
    },
    async criar(userId, i) {
      const [{ id }] = await db.query(
        `insert into wishlist_items (user_id, name, description, link_url, image_url, price, priority, status, purchased_at)
         values ($1, $2, $3, $4, $5, $6::numeric, $7, $8, case when $8 = 'comprado' then now() end)
         returning id`,
        [userId, i.nome, i.descricao, i.linkUrl, i.imagemUrl, i.preco, i.prioridade, i.status]
      )
      return this.obter(userId, id)
    },
    // Atualização parcial. Nomes de coluna vêm só do código; os valores são parametrizados. Ao mudar o status,
    // a data da compra acompanha (nova ao comprar, preservada se já estava comprado, apagada ao desfazer).
    async atualizar(userId, id, c) {
      const params = [id, userId]
      const sets = []
      const campo = (coluna, valor, cast) => {
        params.push(valor)
        sets.push(`${coluna} = $${params.length}${cast ? `::${cast}` : ''}`)
      }
      if ('nome' in c) campo('name', c.nome)
      if ('descricao' in c) campo('description', c.descricao)
      if ('linkUrl' in c) campo('link_url', c.linkUrl)
      if ('imagemUrl' in c) campo('image_url', c.imagemUrl)
      if ('preco' in c) campo('price', c.preco, 'numeric')
      if ('prioridade' in c) campo('priority', c.prioridade)
      if ('status' in c) {
        params.push(c.status)
        const n = params.length
        sets.push(`status = $${n}::text`)
        sets.push(`purchased_at = case when $${n}::text = 'comprado' then coalesce(purchased_at, now()) else null end`)
      }
      if (!sets.length) return this.obter(userId, id)
      const r = await db.query(
        `update wishlist_items set ${sets.join(', ')}, updated_at = now() where id = $1 and user_id = $2 returning id`,
        params
      )
      return r.length ? this.obter(userId, id) : null
    },
    async excluir(userId, id) {
      const r = await db.query('delete from wishlist_items where id = $1 and user_id = $2 returning id', [id, userId])
      return r.length > 0
    }
  }
}
