import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cliente, criarAmbiente, entrar } from './helpers.js'

let amb, c, c2
beforeAll(async () => {
  amb = await criarAmbiente()
  c = cliente(await entrar(amb.app, { sub: 'desejos-a' }))
  c2 = cliente(await entrar(amb.app, { sub: 'desejos-b' }))
})
afterAll(() => amb.fechar())

const produto = (extra = {}) => ({ nome: 'Fone', preco: 199.9, prioridade: 'media', ...extra })
const criar = async (cli, extra) => (await cli.post('/api/desejos', produto(extra))).body

describe('lista de desejos', () => {
  it('cria com os padrões, edita e exclui', async () => {
    const r = await c.post('/api/desejos', {
      nome: '  Teclado mecânico ',
      descricao: 'Switch azul',
      linkUrl: 'https://loja.exemplo.com/teclado',
      imagemUrl: 'https://img.exemplo.com/t.jpg',
      preco: 349.9,
      prioridade: 'alta'
    })
    expect(r.status).toBe(201)
    expect(r.body.item).toMatchObject({
      nome: 'Teclado mecânico',
      descricao: 'Switch azul',
      linkUrl: 'https://loja.exemplo.com/teclado',
      imagemUrl: 'https://img.exemplo.com/t.jpg',
      preco: 349.9,
      prioridade: 'alta',
      status: 'desejado',
      compradoEm: null
    })
    expect(typeof r.body.item.criadoEm).toBe('number')

    const id = r.body.item.id
    const e = await c.patch(`/api/desejos/${id}`, { nome: 'Teclado 75%', prioridade: 'baixa', preco: 300, linkUrl: null })
    expect(e.body.item).toMatchObject({ nome: 'Teclado 75%', prioridade: 'baixa', preco: 300, linkUrl: null, descricao: 'Switch azul' })

    const d = await c.delete(`/api/desejos/${id}`)
    expect(d.status).toBe(200)
    expect((await c.get('/api/desejos')).body.itens.some((i) => i.id === id)).toBe(false)
    expect((await c.delete(`/api/desejos/${id}`)).status).toBe(404)
  })

  it('só exige nome e preço; aceita preço zero; opcionais vazios viram null', async () => {
    const r = await c.post('/api/desejos', { nome: 'Algo', preco: 0, linkUrl: '', imagemUrl: '   ' })
    expect(r.status).toBe(201)
    expect(r.body.item).toMatchObject({ preco: 0, linkUrl: null, imagemUrl: null, descricao: '', prioridade: 'media', status: 'desejado' })
  })

  it('valida campos: nome, preço, prioridade, status e tamanhos', async () => {
    const ruim = async (extra) => (await c.post('/api/desejos', produto(extra))).status
    expect(await ruim({ nome: '   ' })).toBe(400)
    expect(await ruim({ nome: 'x'.repeat(121) })).toBe(400)
    expect(await ruim({ preco: -1 })).toBe(400)
    expect(await ruim({ preco: '10' })).toBe(400)
    expect(await ruim({ preco: null })).toBe(400)
    expect(await ruim({ prioridade: 'urgente' })).toBe(400)
    expect(await ruim({ status: 'quase' })).toBe(400)
    expect(await ruim({ descricao: 'x'.repeat(501) })).toBe(400)
    expect((await c.post('/api/desejos', { nome: 'Sem preço' })).status).toBe(400)
  })

  it('só aceita links http/https, sem credenciais embutidas', async () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'file:///etc/passwd', 'ftp://x.com/a', 'não é url', 'https://user:senha@loja.com/x', '//loja.com/x']) {
      expect((await c.post('/api/desejos', produto({ linkUrl: url }))).status).toBe(400)
      expect((await c.post('/api/desejos', produto({ imagemUrl: url }))).status).toBe(400)
    }
    expect((await c.post('/api/desejos', produto({ linkUrl: 'http://loja.com/x?a=1&b=2#topo' }))).status).toBe(201)
    expect((await c.post('/api/desejos', produto({ linkUrl: `https://loja.com/${'a'.repeat(2000)}` }))).status).toBe(400)
  })

  it('marcar como comprado guarda a data e desfazer a apaga; os dados permanecem', async () => {
    const { item } = await criar(c, { nome: 'Mouse', preco: 120 })
    const comprado = await c.patch(`/api/desejos/${item.id}`, { status: 'comprado' })
    expect(comprado.body.item.status).toBe('comprado')
    expect(typeof comprado.body.item.compradoEm).toBe('number')
    expect(comprado.body.item).toMatchObject({ nome: 'Mouse', preco: 120 })

    // Marcar de novo não muda a data original da compra.
    const repetido = await c.patch(`/api/desejos/${item.id}`, { status: 'comprado' })
    expect(repetido.body.item.compradoEm).toBe(comprado.body.item.compradoEm)

    const desfeito = await c.patch(`/api/desejos/${item.id}`, { status: 'desejado' })
    expect(desfeito.body.item).toMatchObject({ status: 'desejado', compradoEm: null, nome: 'Mouse' })
  })

  it('lista por prioridade (alta, média, baixa) e mantém a ordem depois de editar', async () => {
    const u = cliente(await entrar(amb.app, { sub: 'desejos-ordem' }))
    const b = (await criar(u, { nome: 'Baixa', prioridade: 'baixa' })).item
    const m = (await criar(u, { nome: 'Média', prioridade: 'media' })).item
    const a = (await criar(u, { nome: 'Alta', prioridade: 'alta' })).item
    const nomes = async () => (await u.get('/api/desejos')).body.itens.map((i) => i.nome)
    expect(await nomes()).toEqual(['Alta', 'Média', 'Baixa'])

    await u.patch(`/api/desejos/${b.id}`, { prioridade: 'alta' })
    expect(await nomes()).toEqual(['Alta', 'Baixa', 'Média']) // dentro da prioridade, os mais novos primeiro

    // Comprado fica depois dos desejados da mesma prioridade, sem sair da prioridade.
    await u.patch(`/api/desejos/${a.id}`, { status: 'comprado' })
    expect(await nomes()).toEqual(['Baixa', 'Alta', 'Média'])
    await u.patch(`/api/desejos/${a.id}`, { status: 'desejado' })
    expect(await nomes()).toEqual(['Alta', 'Baixa', 'Média'])
    expect(m.id).toBeTruthy()
  })

  it('totais vêm do banco e batem depois de cada operação (sem erro de centavos)', async () => {
    const u = cliente(await entrar(amb.app, { sub: 'desejos-totais' }))
    expect((await u.get('/api/desejos')).body.totais).toEqual({ quantidade: 0, desejados: 0, comprados: 0, valorDesejado: 0, valorComprado: 0, valorTotal: 0 })

    const a = (await criar(u, { nome: 'A', preco: 0.1 })).item
    const b = await criar(u, { nome: 'B', preco: 0.2 })
    expect(b.totais).toEqual({ quantidade: 2, desejados: 2, comprados: 0, valorDesejado: 0.3, valorComprado: 0, valorTotal: 0.3 })

    const comprado = await u.patch(`/api/desejos/${a.id}`, { status: 'comprado' })
    expect(comprado.body.totais).toEqual({ quantidade: 2, desejados: 1, comprados: 1, valorDesejado: 0.2, valorComprado: 0.1, valorTotal: 0.3 })

    const editado = await u.patch(`/api/desejos/${a.id}`, { preco: 99.99 })
    expect(editado.body.totais).toMatchObject({ valorDesejado: 0.2, valorComprado: 99.99, valorTotal: 100.19 })

    const apagado = await u.delete(`/api/desejos/${a.id}`)
    expect(apagado.body.totais).toEqual({ quantidade: 1, desejados: 1, comprados: 0, valorDesejado: 0.2, valorComprado: 0, valorTotal: 0.2 })
    expect((await u.get('/api/desejos')).body.totais).toEqual(apagado.body.totais)
  })

  it('cada conta enxerga e altera só os próprios produtos', async () => {
    const { item } = await criar(c, { nome: 'Privado', preco: 50 })
    expect((await c2.get('/api/desejos')).body.itens.some((i) => i.id === item.id)).toBe(false)
    expect((await c2.patch(`/api/desejos/${item.id}`, { nome: 'invadido' })).status).toBe(404)
    expect((await c2.patch(`/api/desejos/${item.id}`, { status: 'comprado' })).status).toBe(404)
    expect((await c2.delete(`/api/desejos/${item.id}`)).status).toBe(404)
    expect((await c2.get('/api/desejos')).body.totais.valorTotal).toBe(0)
    expect((await c.get('/api/desejos')).body.itens.find((i) => i.id === item.id)).toMatchObject({ nome: 'Privado', status: 'desejado' })
    expect((await c.patch('/api/desejos/não-é-uuid', { nome: 'x' })).status).toBe(404)
  })

  it('o banco recusa estados inconsistentes', async () => {
    const [u] = await amb.db.query('select id from users limit 1')
    const tenta = (sql) => amb.db.query(sql, [u.id]).then(() => 'ok', () => 'erro')
    expect(await tenta("insert into wishlist_items (user_id, name, price, status) values ($1, 'x', 1, 'comprado')")).toBe('erro') // sem data de compra
    expect(await tenta("insert into wishlist_items (user_id, name, price) values ($1, 'x', -1)")).toBe('erro')
    expect(await tenta("insert into wishlist_items (user_id, name, price, link_url) values ($1, 'x', 1, 'javascript:alert(1)')")).toBe('erro')
    expect(await tenta("insert into wishlist_items (user_id, name, price, priority) values ($1, 'x', 1, 'urgente')")).toBe('erro')
  })

  it('exige login', async () => {
    const sem = await import('supertest').then((m) => m.default(amb.app).get('/api/desejos'))
    expect(sem.status).toBe(401)
  })
})
