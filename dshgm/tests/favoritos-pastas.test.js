import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cliente, criarAmbiente, entrar } from './helpers.js'

let amb, c, outro
beforeAll(async () => {
  amb = await criarAmbiente()
  c = cliente(await entrar(amb.app, { sub: 'fav-a' }))
  outro = cliente(await entrar(amb.app, { sub: 'fav-b' }))
})
afterAll(() => amb.fechar())

const link = (extra = {}) => ({ nome: 'Site', url: 'https://exemplo.com', ...extra })
const pasta = async (nome, barra = 'central', cli = c) => (await cli.post('/api/favoritos/pastas', { nome, barra })).body.pasta

describe('favoritos: barra e pastas', () => {
  it('sem pasta e sem barra, o link vai solto para a barra central (comportamento antigo)', async () => {
    const f = (await c.post('/api/favoritos', link())).body.favorito
    expect(f).toMatchObject({ pastaId: null, barra: 'central', fixado: true })
  })

  it('o link pode ficar solto na barra superior', async () => {
    const f = (await c.post('/api/favoritos', link({ barra: 'superior' }))).body.favorito
    expect(f).toMatchObject({ pastaId: null, barra: 'superior' })
  })

  it('GET devolve links e pastas juntos', async () => {
    await pasta('Trabalho', 'superior')
    const r = await c.get('/api/favoritos')
    expect(Array.isArray(r.body.favoritos)).toBe(true)
    expect(r.body.pastas.some((p) => p.nome === 'Trabalho' && p.barra === 'superior')).toBe(true)
  })

  it('link dentro de uma pasta herda a barra da pasta, mesmo que peça outra', async () => {
    const p = await pasta('Estudo', 'superior')
    const f = (await c.post('/api/favoritos', link({ pastaId: p.id, barra: 'central' }))).body.favorito
    expect(f).toMatchObject({ pastaId: p.id, barra: 'superior' })
  })

  it('mudar a barra da pasta leva os links dela junto', async () => {
    const p = await pasta('Mover', 'central')
    const f1 = (await c.post('/api/favoritos', link({ pastaId: p.id }))).body.favorito
    const f2 = (await c.post('/api/favoritos', link({ pastaId: p.id, nome: 'Outro' }))).body.favorito
    const r = await c.patch(`/api/favoritos/pastas/${p.id}`, { barra: 'superior' })
    expect(r.body.pasta.barra).toBe('superior')
    const lista = (await c.get('/api/favoritos')).body.favoritos
    expect(lista.find((x) => x.id === f1.id).barra).toBe('superior')
    expect(lista.find((x) => x.id === f2.id).barra).toBe('superior')
  })

  it('mover um link para uma pasta e tirá-lo dela', async () => {
    const p = await pasta('Ida e volta', 'superior')
    const f = (await c.post('/api/favoritos', link())).body.favorito
    let r = await c.patch(`/api/favoritos/${f.id}`, { pastaId: p.id })
    expect(r.body.favorito).toMatchObject({ pastaId: p.id, barra: 'superior' })
    r = await c.patch(`/api/favoritos/${f.id}`, { pastaId: null, barra: 'central' })
    expect(r.body.favorito).toMatchObject({ pastaId: null, barra: 'central' })
  })

  it('link que está numa pasta ignora pedido de trocar só a barra', async () => {
    const p = await pasta('Fixa', 'superior')
    const f = (await c.post('/api/favoritos', link({ pastaId: p.id }))).body.favorito
    const r = await c.patch(`/api/favoritos/${f.id}`, { barra: 'central' })
    expect(r.body.favorito.barra).toBe('superior')
  })

  it('excluir a pasta NÃO apaga os links: ficam soltos e mantêm a barra', async () => {
    const p = await pasta('Descartável', 'superior')
    const f = (await c.post('/api/favoritos', link({ pastaId: p.id }))).body.favorito
    expect((await c.delete(`/api/favoritos/pastas/${p.id}`)).status).toBe(204)
    const depois = (await c.get('/api/favoritos')).body.favoritos.find((x) => x.id === f.id)
    expect(depois).toMatchObject({ pastaId: null, barra: 'superior' })
  })

  it('validações: barra inválida, nome vazio, nome repetido (sem diferenciar maiúsculas), pasta inexistente', async () => {
    expect((await c.post('/api/favoritos', link({ barra: 'lateral' }))).status).toBe(400)
    expect((await c.post('/api/favoritos/pastas', { nome: '  ', barra: 'central' })).status).toBe(400)
    expect((await c.post('/api/favoritos/pastas', { nome: 'Nome Único' })).status).toBe(201)
    expect((await c.post('/api/favoritos/pastas', { nome: 'nome único' })).status).toBe(409)
    expect((await c.post('/api/favoritos', link({ pastaId: '00000000-0000-4000-8000-000000000000' }))).status).toBe(400)
    expect((await c.patch('/api/favoritos/pastas/nao-e-uuid', { nome: 'x' })).status).toBe(404)
  })

  it('renomear a pasta para o nome dela mesma é permitido', async () => {
    const p = await pasta('Mesmo nome')
    expect((await c.patch(`/api/favoritos/pastas/${p.id}`, { nome: 'Mesmo nome', barra: 'superior' })).status).toBe(200)
  })

  it('isolamento: outro usuário não vê, não edita, não exclui e não usa a pasta', async () => {
    const p = await pasta('Privada', 'superior')
    expect((await outro.get('/api/favoritos')).body.pastas.some((x) => x.id === p.id)).toBe(false)
    expect((await outro.patch(`/api/favoritos/pastas/${p.id}`, { nome: 'Invadida' })).status).toBe(404)
    expect((await outro.delete(`/api/favoritos/pastas/${p.id}`)).status).toBe(404)
    expect((await outro.post('/api/favoritos', link({ pastaId: p.id }))).status).toBe(400)
    // o mesmo nome pode existir para outro usuário
    expect((await outro.post('/api/favoritos/pastas', { nome: 'Privada' })).status).toBe(201)
  })
})

describe('favoritos: editar e excluir categorias', () => {
  it('renomeia a categoria em todos os links dela', async () => {
    await c.post('/api/favoritos', link({ categoria: 'Trabalho' }))
    await c.post('/api/favoritos', link({ categoria: 'Trabalho', nome: 'Outro' }))
    const r = await c.patch('/api/favoritos/categorias', { de: 'Trabalho', para: 'Escritório' })
    expect(r.status).toBe(200)
    expect(r.body.atualizados).toBe(2)
    const cats = (await c.get('/api/favoritos')).body.favoritos.map((f) => f.categoria)
    expect(cats).toContain('Escritório')
    expect(cats).not.toContain('Trabalho')
  })

  it('excluir a categoria move os links para "Dia a dia" (nada é apagado)', async () => {
    const f = (await c.post('/api/favoritos', link({ categoria: 'Temporária' }))).body.favorito
    const r = await c.delete('/api/favoritos/categorias?nome=Tempor%C3%A1ria')
    expect(r.status).toBe(200)
    expect(r.body.movidos).toBe(1)
    const depois = (await c.get('/api/favoritos')).body.favoritos.find((x) => x.id === f.id)
    expect(depois.categoria).toBe('Dia a dia')
  })

  it('as categorias padrão não podem ser renomeadas nem excluídas', async () => {
    for (const nome of ['Estudos', 'Desenvolvimento', 'Dia a dia', 'Games', 'games']) {
      expect((await c.patch('/api/favoritos/categorias', { de: nome, para: 'X' })).status, nome).toBe(400)
      expect((await c.delete(`/api/favoritos/categorias?nome=${encodeURIComponent(nome)}`)).status, nome).toBe(400)
    }
  })

  it('só atinge as categorias do próprio usuário', async () => {
    await outro.post('/api/favoritos', link({ categoria: 'Compartilhada' }))
    await c.post('/api/favoritos', link({ categoria: 'Compartilhada' }))
    await c.patch('/api/favoritos/categorias', { de: 'Compartilhada', para: 'Minha' })
    const deOutro = (await outro.get('/api/favoritos')).body.favoritos.map((f) => f.categoria)
    expect(deOutro).toContain('Compartilhada')
    expect(deOutro).not.toContain('Minha')
  })
})
