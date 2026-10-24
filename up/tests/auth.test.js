import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { APP_URL, cliente, criarAmbiente, entrar } from './helpers.js'

let amb
beforeAll(async () => { amb = await criarAmbiente() })
afterAll(() => amb.fechar())

describe('autenticação Google', () => {
  it('bloqueia endpoints privados sem login', async () => {
    for (const rota of ['/api/tarefas', '/api/transacoes', '/api/eventos', '/api/favoritos', '/api/lazer', '/api/preferencias', '/api/meta', '/api/calendario/status']) {
      const r = await request(amb.app).get(rota)
      expect(r.status, rota).toBe(401)
      expect(r.body.erro.codigo).toBe('nao_autenticado')
    }
    expect((await request(amb.app).get('/api/auth/me')).status).toBe(401)
  })

  it('/api/saude é pública', async () => {
    expect((await request(amb.app).get('/api/saude')).body).toEqual({ ok: true })
  })

  it('login completo cria usuário, sessão HttpOnly e redireciona para o destino seguro', async () => {
    const s = await entrar(amb.app, { sub: 'g-1', email: 'um@exemplo.test' })
    expect(s.volta.status).toBe(302)
    expect(s.volta.headers.location).toBe(`${APP_URL}/financeiro.html`)
    const cookie = s.volta.headers['set-cookie'].find((c) => c.startsWith('sid='))
    expect(cookie).toMatch(/HttpOnly/)
    expect(cookie).toMatch(/SameSite=Lax/)
    expect(s.me.status).toBe(200)
    expect(s.usuario.email).toBe('um@exemplo.test')
    expect(s.csrf).toBeTruthy()
  })

  it('o identificador do banco guarda só o hash da sessão', async () => {
    const s = await entrar(amb.app, { sub: 'g-hash' })
    const sid = s.volta.headers['set-cookie'].find((c) => c.startsWith('sid=')).split(';')[0].slice(4)
    const linhas = await amb.db.query('select id_hash from sessions')
    expect(linhas.some((l) => l.id_hash === sid)).toBe(false)
    expect(linhas.every((l) => /^[0-9a-f]{64}$/.test(l.id_hash))).toBe(true)
  })

  it('identifica o usuário pelo "sub" e não pelo e-mail', async () => {
    await entrar(amb.app, { sub: 'g-sub', email: 'antigo@exemplo.test' })
    await entrar(amb.app, { sub: 'g-sub', email: 'novo@exemplo.test' })
    const l = await amb.db.query("select email from users where google_sub = 'g-sub'")
    expect(l).toEqual([{ email: 'novo@exemplo.test' }])
  })

  it('rejeita state inválido e não cria sessão', async () => {
    const agent = request.agent(amb.app)
    const inicio = await agent.get('/api/auth/google/start')
    const nonce = new URL(inicio.headers.location).searchParams.get('nonce')
    const r = await agent.get('/api/auth/google/callback').query({ code: `x|x@x.test|${nonce}`, state: 'errado' })
    expect(r.headers.location).toBe(`${APP_URL}/?erro_login=estado_invalido`)
    expect((await agent.get('/api/auth/me')).status).toBe(401)
  })

  it('rejeita nonce incorreto no id_token', async () => {
    const agent = request.agent(amb.app)
    const inicio = await agent.get('/api/auth/google/start')
    const state = new URL(inicio.headers.location).searchParams.get('state')
    const r = await agent.get('/api/auth/google/callback').query({ code: 'x|x@x.test|nonce-falso', state })
    expect(r.headers.location).toBe(`${APP_URL}/?erro_login=falha`)
  })

  it('rejeita callback sem passar pelo início do fluxo', async () => {
    const r = await request(amb.app).get('/api/auth/google/callback').query({ code: 'a|b@c.test|n', state: 's' })
    expect(r.headers.location).toBe(`${APP_URL}/?erro_login=sessao_expirada`)
  })

  it('trata cancelamento do usuário', async () => {
    const agent = request.agent(amb.app)
    const inicio = await agent.get('/api/auth/google/start')
    const state = new URL(inicio.headers.location).searchParams.get('state')
    const r = await agent.get('/api/auth/google/callback').query({ error: 'access_denied', state })
    expect(r.headers.location).toBe(`${APP_URL}/?erro_login=cancelado`)
  })

  it('não permite redirecionamento aberto via returnTo', async () => {
    for (const mal of ['//evil.test', 'https://evil.test', '/\\evil', '/../x', 'javascript:alert(1)']) {
      const agent = request.agent(amb.app)
      const inicio = await agent.get('/api/auth/google/start').query({ returnTo: mal })
      const u = new URL(inicio.headers.location)
      const volta = await agent.get('/api/auth/google/callback').query({ code: `r|r@x.test|${u.searchParams.get('nonce')}`, state: u.searchParams.get('state') })
      expect(volta.headers.location, mal).toBe(`${APP_URL}/`)
    }
  })

  it('o início do fluxo usa PKCE S256 e escopos mínimos de login', async () => {
    const inicio = await request(amb.app).get('/api/auth/google/start')
    const u = new URL(inicio.headers.location)
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('scope')).toBe('openid email profile')
    expect(u.searchParams.get('redirect_uri')).toBe(`${APP_URL}/api/auth/google/callback`)
  })

  it('exige token CSRF nas escritas', async () => {
    const s = await entrar(amb.app, { sub: 'g-csrf' })
    const sem = await s.agent.post('/api/tarefas').send({ texto: 'x' })
    expect(sem.status).toBe(403)
    const errado = await s.agent.post('/api/tarefas').set('X-CSRF-Token', 'falso').send({ texto: 'x' })
    expect(errado.status).toBe(403)
    expect((await cliente(s).post('/api/tarefas', { texto: 'x' })).status).toBe(201)
  })

  it('recusa escritas vindas de outra origem', async () => {
    const s = await entrar(amb.app, { sub: 'g-origem' })
    const r = await s.agent.post('/api/tarefas').set('Origin', 'https://evil.test').set('X-CSRF-Token', s.csrf).send({ texto: 'x' })
    expect(r.status).toBe(403)
  })

  it('logout invalida a sessão no servidor (cookie antigo deixa de valer)', async () => {
    const s = await entrar(amb.app, { sub: 'g-logout' })
    const cookieAntigo = s.volta.headers['set-cookie'].find((c) => c.startsWith('sid=')).split(';')[0]
    expect((await cliente(s).post('/api/auth/logout', {})).status).toBe(204)
    expect((await s.agent.get('/api/auth/me')).status).toBe(401)
    const replay = await request(amb.app).get('/api/auth/me').set('Cookie', cookieAntigo)
    expect(replay.status).toBe(401)
  })

  it('logout sem CSRF é recusado', async () => {
    const s = await entrar(amb.app, { sub: 'g-logout2' })
    expect((await s.agent.post('/api/auth/logout').send({})).status).toBe(403)
  })

  it('novo login troca o identificador de sessão (sem fixação)', async () => {
    const s = await entrar(amb.app, { sub: 'g-fix' })
    const antigo = s.volta.headers['set-cookie'].find((c) => c.startsWith('sid=')).split(';')[0]
    const novo = await entrar(amb.app, { sub: 'g-fix', agente: s.agent })
    const atual = novo.volta.headers['set-cookie'].find((c) => c.startsWith('sid=')).split(';')[0]
    expect(atual).not.toBe(antigo)
    expect((await request(amb.app).get('/api/auth/me').set('Cookie', antigo)).status).toBe(401)
  })

  it('sessão expirada no banco deixa de valer', async () => {
    const s = await entrar(amb.app, { sub: 'g-exp' })
    await amb.db.query("update sessions set expires_at = now() - interval '1 minute' where user_id = $1", [s.usuario.id])
    expect((await s.agent.get('/api/auth/me')).status).toBe(401)
  })

  it('erros seguem o formato padrão e não vazam detalhes internos', async () => {
    const s = await entrar(amb.app, { sub: 'g-erro' })
    const r = await cliente(s).post('/api/tarefas', { texto: '' })
    expect(r.status).toBe(400)
    expect(r.body.erro).toMatchObject({ codigo: 'validacao' })
    const inexistente = await s.agent.get('/api/nao-existe')
    expect(inexistente.status).toBe(404)
  })
})

describe('lista de e-mails permitidos', () => {
  let restrito
  beforeAll(async () => { restrito = await criarAmbiente({ env: { ALLOWED_EMAILS: ' Dono@Exemplo.test ' } }) })
  afterAll(() => restrito.fechar())

  it('aceita o e-mail da lista (sem diferenciar maiúsculas) e cria a sessão', async () => {
    const s = await entrar(restrito.app, { sub: 'dono', email: 'DONO@exemplo.TEST' })
    expect(s.volta.headers.location).toBe(`${APP_URL}/financeiro.html`)
    expect(s.me.status).toBe(200)
  })

  it('recusa qualquer outra conta ANTES de criar usuário ou sessão', async () => {
    const s = await entrar(restrito.app, { sub: 'intruso', email: 'intruso@exemplo.test' })
    expect(s.volta.headers.location).toBe(`${APP_URL}/?erro_login=nao_autorizado`)
    expect(s.me.status).toBe(401)
    expect(await restrito.db.query("select 1 from users where google_sub = 'intruso'")).toHaveLength(0)
    expect(await restrito.db.query('select 1 from sessions s join users u on u.id = s.user_id where u.email = $1', ['intruso@exemplo.test'])).toHaveLength(0)
  })

  it('remover o e-mail da lista derruba as sessões já abertas', async () => {
    const s = await entrar(restrito.app, { sub: 'dono', email: 'dono@exemplo.test' })
    expect((await s.agent.get('/api/auth/me')).status).toBe(200)
    restrito.config.emailsPermitidos.clear()
    restrito.config.emailsPermitidos.add('outro@exemplo.test')
    expect((await s.agent.get('/api/auth/me')).status).toBe(401)
    expect((await s.agent.get('/api/tarefas')).status).toBe(401)
    restrito.config.emailsPermitidos.add('dono@exemplo.test') // restaura para os demais testes
  })
})
