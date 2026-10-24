import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cliente, criarAmbiente, entrar } from './helpers.js'

let amb, c
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 7)])
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(30, 1)])

beforeAll(async () => {
  amb = await criarAmbiente()
  const s = await entrar(amb.app, { sub: 'conteudo' })
  c = { ...cliente(s), agent: s.agent, csrf: s.csrf }
})
afterAll(() => amb.fechar())

const enviarCapa = (id, corpo, tipo = 'image/jpeg', dim = { l: '300', a: '450' }) =>
  c.agent.put(`/api/lazer/${id}/capa`).set('X-CSRF-Token', c.csrf).set('Content-Type', tipo).set('X-Largura', dim.l).set('X-Altura', dim.a).send(corpo)

describe('favoritos', () => {
  it('CRUD com padrões e validação de URL', async () => {
    const f = (await c.post('/api/favoritos', { nome: 'Docs', url: 'https://developer.mozilla.org' })).body.favorito
    expect(f).toMatchObject({ categoria: 'Dia a dia', fixado: true })
    expect((await c.patch(`/api/favoritos/${f.id}`, { fixado: false, categoria: 'Estudos' })).body.favorito).toMatchObject({ fixado: false, categoria: 'Estudos' })
    for (const url of ['javascript:alert(1)', 'ftp://x.com', 'sem esquema', 'data:text/html,x']) {
      expect((await c.post('/api/favoritos', { nome: 'x', url })).status, url).toBe(400)
    }
    expect((await c.delete(`/api/favoritos/${f.id}`)).status).toBe(204)
  })
})

describe('lazer', () => {
  it('aplica as regras de status e progresso', async () => {
    const i = (await c.post('/api/lazer', { tipo: 'jogo', titulo: 'Zelda', plataforma: 'Switch' })).body.item
    expect(i).toMatchObject({ status: 'pendente', progresso: 0, capa: null })
    expect((await c.patch(`/api/lazer/${i.id}`, { progresso: 40 })).body.item).toMatchObject({ status: 'andamento', progresso: 40 })
    expect((await c.patch(`/api/lazer/${i.id}`, { progresso: 100 })).body.item.status).toBe('concluido')
    expect((await c.patch(`/api/lazer/${i.id}`, { status: 'pendente' })).body.item.progresso).toBe(0)
    expect((await c.patch(`/api/lazer/${i.id}`, { status: 'concluido' })).body.item.progresso).toBe(100)
    const filme = (await c.post('/api/lazer', { tipo: 'filme', titulo: 'Filme', progresso: 80 })).body.item
    expect(filme.progresso).toBe(0)
  })

  it('envia, lê, versiona e remove capas', async () => {
    const i = (await c.post('/api/lazer', { tipo: 'filme', titulo: 'Com capa' })).body.item
    const r = await enviarCapa(i.id, JPEG)
    expect(r.status).toBe(200)
    expect(r.body.item.capa).toEqual({ largura: 300, altura: 450, versao: 1 })
    const img = await c.get(`/api/lazer/${i.id}/capa`).buffer(true).parse((res, cb) => { const p = []; res.on('data', (d) => p.push(d)); res.on('end', () => cb(null, Buffer.concat(p))) })
    expect(img.headers['content-type']).toBe('image/jpeg')
    expect(img.body.equals(JPEG)).toBe(true)
    expect((await enviarCapa(i.id, PNG, 'image/png')).body.item.capa.versao).toBe(2)
    expect((await c.delete(`/api/lazer/${i.id}/capa`)).body.item.capa).toBeNull()
    expect((await c.get(`/api/lazer/${i.id}/capa`)).status).toBe(404)
  })

  it('recusa arquivo que não é imagem, tipo divergente e dimensões inválidas', async () => {
    const i = (await c.post('/api/lazer', { tipo: 'serie', titulo: 'Série' })).body.item
    expect((await enviarCapa(i.id, Buffer.from('<script>alert(1)</script>'))).status).toBe(400)
    expect((await enviarCapa(i.id, PNG, 'image/jpeg')).status).toBe(400)
    expect((await enviarCapa(i.id, JPEG, 'image/jpeg', { l: '0', a: '10' })).status).toBe(400)
    expect((await enviarCapa(i.id, JPEG, 'image/gif')).status).toBe(400)
  })

  it('excluir o item exclui a capa', async () => {
    const i = (await c.post('/api/lazer', { tipo: 'jogo', titulo: 'Temp' })).body.item
    await enviarCapa(i.id, JPEG)
    await c.delete(`/api/lazer/${i.id}`)
    expect(await amb.db.query('select 1 from leisure_covers where item_id = $1', [i.id])).toHaveLength(0)
  })
})

describe('preferências e perfil', () => {
  it('mescla alterações parciais sem perder o restante', async () => {
    await c.patch('/api/preferencias', { nome: 'Gustavo', destaque: 'menta', clima: { unidade: 'F' }, cartoes: { clima: false } })
    const r = await c.patch('/api/preferencias', { hora24: false, clima: { ativo: true }, cartoes: { tarefas: true } })
    expect(r.body.preferencias).toMatchObject({
      nome: 'Gustavo', destaque: 'menta', hora24: false, clima: { unidade: 'F', ativo: true }, cartoes: { clima: false, tarefas: true }, foto: null
    })
  })

  it('valida valores e ignora campos desconhecidos', async () => {
    expect((await c.patch('/api/preferencias', { destaque: 'neon' })).status).toBe(400)
    expect((await c.patch('/api/preferencias', { inicioSemana: 3 })).status).toBe(400)
    const r = await c.patch('/api/preferencias', { invasor: 'x' })
    expect(r.body.preferencias.invasor).toBeUndefined()
  })

  it('guarda, mantém e remove a foto; recusa conteúdo que não é imagem', async () => {
    const foto = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
    expect((await c.patch('/api/preferencias', { foto })).body.preferencias.foto).toBe(foto)
    expect((await c.patch('/api/preferencias', { nome: 'Outro' })).body.preferencias.foto).toBe(foto)
    expect((await c.patch('/api/preferencias', { foto: 'data:text/html;base64,PHNjcmlwdD4=' })).status).toBe(400)
    expect((await c.patch('/api/preferencias', { foto: 'a'.repeat(700000) })).status).toBe(400)
    expect((await c.patch('/api/preferencias', { foto: null })).body.preferencias.foto).toBeNull()
  })

  it('atualiza o fuso horário somente se válido', async () => {
    expect((await c.put('/api/fuso', { fuso: 'America/Bahia' })).status).toBe(200)
    expect((await c.put('/api/fuso', { fuso: 'Marte/Olympus' })).status).toBe(400)
  })
})
