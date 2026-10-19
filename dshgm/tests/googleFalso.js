// Google simulado (OAuth + Calendar API) para os testes. Nenhuma chamada de rede real é feita.
// Código OAuth falso: "sub|email|nonce[|sem_calendario]"
const json = (corpo, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')

export function criarGoogleFalso({ clientId = 'cid-teste' } = {}) {
  const calendarios = new Map() // sub -> { eventos: Map, versao }
  const revogados = new Set() // refresh tokens revogados
  const tokensRevogadosPeloApp = []
  const tokensDeSyncExpirados = new Set()
  const falhas = [] // { metodo, status, restantes }
  const chamadas = []

  const cal = (sub) => {
    if (!calendarios.has(sub)) calendarios.set(sub, { eventos: new Map(), versao: 0 })
    return calendarios.get(sub)
  }
  const publico = ({ _v, ...resto }) => resto
  const carimbar = (c, ev) => {
    c.versao++
    ev._v = c.versao
    ev.etag = `"etag-${c.versao}"`
    ev.updated = new Date().toISOString()
    return ev
  }

  async function tratarToken(corpo) {
    const tipo = corpo.get('grant_type')
    if (tipo === 'authorization_code') {
      const [sub, email, nonce, extra] = corpo.get('code').split('|')
      const escopos = extra === 'sem_calendario' ? 'openid email' : 'openid email https://www.googleapis.com/auth/calendar.events'
      const claims = {
        iss: 'https://accounts.google.com', aud: clientId, exp: Math.floor(Date.now() / 1000) + 3600,
        sub, email, email_verified: true, name: `Nome ${sub}`, picture: `https://exemplo.test/${sub}.png`, nonce
      }
      return json({
        access_token: `at:${sub}`, refresh_token: `rt:${sub}`, scope: escopos, expires_in: 3600,
        id_token: `${b64({ alg: 'RS256' })}.${b64(claims)}.assinatura`
      })
    }
    if (tipo === 'refresh_token') {
      const rt = corpo.get('refresh_token')
      if (revogados.has(rt) || !rt.startsWith('rt:')) return json({ error: 'invalid_grant', error_description: 'Token revogado' }, 400)
      return json({ access_token: `at:${rt.slice(3)}`, expires_in: 3600 })
    }
    return json({ error: 'unsupported_grant_type' }, 400)
  }

  function tratarCalendario(url, metodo, cabecalhos, corpo) {
    const sub = (cabecalhos.Authorization ?? '').replace('Bearer at:', '')
    const c = cal(sub)
    const m = url.pathname.match(/\/calendars\/[^/]+\/events(?:\/([^/]+))?$/)
    const id = m?.[1]

    const falha = falhas.find((f) => f.metodo === metodo && f.restantes > 0)
    if (falha) {
      falha.restantes--
      return json({ error: { message: 'Falha simulada', errors: [{ reason: 'backendError' }] } }, falha.status)
    }

    if (!id && metodo === 'POST') {
      if (c.eventos.has(corpo.id)) return json({ error: { message: 'Já existe', errors: [{ reason: 'duplicate' }] } }, 409)
      const ev = carimbar(c, { ...corpo, status: 'confirmed' })
      c.eventos.set(ev.id, ev)
      return json(publico(ev))
    }
    if (!id && metodo === 'GET') {
      const st = url.searchParams.get('syncToken')
      if (st && tokensDeSyncExpirados.has(st)) return json({ error: { message: 'Gone', errors: [{ reason: 'fullSyncRequired' }] } }, 410)
      const desde = st ? Number(st.replace('st-', '')) : 0
      const itens = [...c.eventos.values()].filter((e) => (st ? e._v > desde : e.status !== 'cancelled'))
      return json({ items: itens.map(publico), nextSyncToken: `st-${c.versao}` })
    }
    const ev = c.eventos.get(id)
    if (metodo === 'GET') return ev ? json(publico(ev)) : json({ error: { message: 'Não encontrado' } }, 404)
    if (metodo === 'PATCH') {
      if (!ev || (ev.status === 'cancelled' && corpo.status !== 'confirmed')) return json({ error: { message: 'Não encontrado' } }, 404)
      const ifMatch = cabecalhos['If-Match']
      if (ifMatch && ifMatch !== ev.etag) return json({ error: { message: 'Precondition', errors: [{ reason: 'conditionNotMet' }] } }, 412)
      Object.assign(ev, corpo)
      carimbar(c, ev)
      return json(publico(ev))
    }
    if (metodo === 'DELETE') {
      if (!ev || ev.status === 'cancelled') return json({ error: { message: 'Gone' } }, 410)
      ev.status = 'cancelled'
      carimbar(c, ev)
      return new Response(null, { status: 204 })
    }
    return json({ error: { message: 'Rota não simulada' } }, 400)
  }

  async function fetchFalso(entrada, opcoes = {}) {
    const url = new URL(String(entrada))
    const metodo = opcoes.method ?? 'GET'
    chamadas.push(`${metodo} ${url.pathname}`)
    if (url.host === 'oauth2.googleapis.com' && url.pathname === '/token') return tratarToken(opcoes.body)
    if (url.host === 'oauth2.googleapis.com' && url.pathname === '/revoke') {
      tokensRevogadosPeloApp.push(opcoes.body.get('token'))
      return json({})
    }
    if (url.host === 'www.googleapis.com') {
      return tratarCalendario(url, metodo, opcoes.headers ?? {}, opcoes.body ? JSON.parse(opcoes.body) : undefined)
    }
    throw new Error(`Chamada de rede inesperada nos testes: ${url}`)
  }

  return {
    fetch: fetchFalso,
    chamadas,
    tokensRevogadosPeloApp,
    // --- manipulação do "Google" pelos testes ---
    eventos: (sub) => [...cal(sub).eventos.values()].filter((e) => e.status !== 'cancelled').map(publico),
    todos: (sub) => [...cal(sub).eventos.values()].map(publico),
    criarRemoto(sub, evento) {
      const c = cal(sub)
      const ev = carimbar(c, { status: 'confirmed', ...evento })
      c.eventos.set(ev.id, ev)
      return publico(ev)
    },
    alterarRemoto(sub, id, mudancas) {
      const c = cal(sub)
      const ev = c.eventos.get(id)
      Object.assign(ev, mudancas)
      carimbar(c, ev)
    },
    apagarRemoto(sub, id) {
      const c = cal(sub)
      const ev = c.eventos.get(id)
      ev.status = 'cancelled'
      carimbar(c, ev)
    },
    revogarAcesso: (sub) => revogados.add(`rt:${sub}`),
    expirarSyncTokens() {
      for (const c of calendarios.values()) for (let v = 0; v <= c.versao + 1; v++) tokensDeSyncExpirados.add(`st-${v}`)
    },
    falharProximas(metodo, status, restantes = 1) {
      falhas.push({ metodo, status, restantes })
    },
    limparFalhas: () => (falhas.length = 0)
  }
}
