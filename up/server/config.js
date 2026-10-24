import { fusoValido } from './lib/dates.js'

const LOGIN_ESCOPOS = ['openid', 'email', 'profile']
const CALENDARIO_ESCOPOS = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events']

function origemDe(url) {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

// Lê e valida o ambiente. Em produção, configuração incompleta impede a inicialização (falha cedo).
export function carregarConfig(env = process.env) {
  const producao = env.NODE_ENV === 'production'
  const appUrl = (env.APP_URL ?? '').replace(/\/+$/, '')
  const faltando = []

  const exigir = (nome) => {
    if (!env[nome]) faltando.push(nome)
    return env[nome] ?? ''
  }

  const config = {
    producao,
    appUrl,
    appOrigin: origemDe(appUrl),
    databaseUrl: env.DATABASE_URL ?? '',
    sessionSecret: env.SESSION_SECRET ?? '',
    tokenEncryptionKey: env.TOKEN_ENCRYPTION_KEY ?? '',
    google: {
      clientId: env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
      loginRedirectUri: `${appUrl}/api/auth/google/callback`,
      calendarRedirectUri: `${appUrl}/api/calendario/callback`,
      loginEscopos: LOGIN_ESCOPOS,
      calendarioEscopos: CALENDARIO_ESCOPOS
    },
    // Somente estes e-mails (verificados pelo Google) podem entrar. Vazio = qualquer conta (apenas em desenvolvimento).
    emailsPermitidos: new Set(
      (env.ALLOWED_EMAILS ?? '')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.includes('@'))
    ),
    fusoPadrao: fusoValido(env.DEFAULT_TIMEZONE) ? env.DEFAULT_TIMEZONE : 'America/Sao_Paulo',
    origensPermitidas: new Set(
      [appUrl, ...(env.ALLOWED_ORIGINS ?? '').split(',')]
        .map((o) => origemDe(o.trim()))
        .filter(Boolean)
    ),
    sessao: {
      cookie: producao ? '__Host-sid' : 'sid',
      ociosaSeg: 60 * 60 * 24 * 14, // 14 dias sem uso
      absolutaSeg: 60 * 60 * 24 * 30 // 30 dias no máximo
    },
    cookieOAuth: producao ? '__Host-oauth_tx' : 'oauth_tx'
  }

  if (producao) {
    for (const nome of ['APP_URL', 'DATABASE_URL', 'SESSION_SECRET', 'TOKEN_ENCRYPTION_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']) {
      exigir(nome)
    }
    if (faltando.length) throw new Error(`Variáveis de ambiente ausentes: ${faltando.join(', ')}`)
    if (!config.emailsPermitidos.size) {
      throw new Error('ALLOWED_EMAILS deve listar ao menos um e-mail em produção (senão qualquer conta Google entraria).')
    }
    if (!appUrl.startsWith('https://')) throw new Error('APP_URL deve usar https em produção.')
    if (config.sessionSecret.length < 32) throw new Error('SESSION_SECRET deve ter ao menos 32 caracteres.')
    if (Buffer.from(config.tokenEncryptionKey, 'base64').length !== 32) {
      throw new Error('TOKEN_ENCRYPTION_KEY deve ter 32 bytes em base64.')
    }
  }
  return config
}
