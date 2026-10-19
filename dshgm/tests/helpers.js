import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import request from 'supertest'
import { carregarConfig } from '../server/config.js'
import { criarApp } from '../server/app.js'
import { aplicarMigracoes } from '../server/db/migrator.js'
import { criarGoogleFalso } from './googleFalso.js'

export const PASTA_MIGRACOES = fileURLToPath(new URL('../db/migrations', import.meta.url))
export const APP_URL = 'http://127.0.0.1:5173'
export const CHAVE_TESTE = randomBytes(32).toString('base64')

export function envDeTeste(extra = {}) {
  return {
    NODE_ENV: 'test',
    APP_URL,
    SESSION_SECRET: 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres',
    TOKEN_ENCRYPTION_KEY: CHAVE_TESTE,
    GOOGLE_CLIENT_ID: 'cid-teste',
    GOOGLE_CLIENT_SECRET: 'segredo-google-teste',
    ...extra
  }
}

// Banco PostgreSQL real (WASM) em memória, com as MESMAS migrações usadas em produção.
export async function criarAmbiente({ limitar = false, env = {} } = {}) {
  const pg = new PGlite()
  await aplicarMigracoes({ exec: (sql) => pg.exec(sql), rows: async (sql, p) => (await pg.query(sql, p)).rows }, PASTA_MIGRACOES)
  const db = { query: async (texto, params = []) => (await pg.query(texto, params)).rows }
  const google = criarGoogleFalso()
  const config = carregarConfig(envDeTeste(env))
  const servidor = criarApp({ config, db, fetchImpl: google.fetch, limitar, atrasosRede: [1, 1] })
  return { ...servidor, config, db, pg, google, fechar: () => pg.close() }
}

// Faz o fluxo de login completo (start -> callback) com o Google simulado.
export async function entrar(app, { sub = 'sub-1', email = `${sub}@exemplo.test`, agente } = {}) {
  const agent = agente ?? request.agent(app)
  const inicio = await agent.get('/api/auth/google/start?returnTo=/financeiro.html')
  const destino = new URL(inicio.headers.location)
  const state = destino.searchParams.get('state')
  const nonce = destino.searchParams.get('nonce')
  const volta = await agent.get('/api/auth/google/callback').query({ code: `${sub}|${email}|${nonce}`, state })
  const me = await agent.get('/api/auth/me')
  return { agent, sub, csrf: me.body.csrfToken, usuario: me.body.usuario, inicio, volta, me }
}

// Atalhos que já enviam o token CSRF.
export function cliente({ agent, csrf }) {
  const escrever = (metodo) => (url, corpo) => agent[metodo](url).set('X-CSRF-Token', csrf).send(corpo)
  return {
    get: (url) => agent.get(url),
    post: escrever('post'),
    patch: escrever('patch'),
    put: escrever('put'),
    delete: (url) => agent.delete(url).set('X-CSRF-Token', csrf)
  }
}

// Autoriza o Google Calendar (fluxo separado do login).
export async function conectarCalendario(app, sessao, { semPermissao = false } = {}) {
  const inicio = await sessao.agent.get('/api/calendario/conectar')
  const destino = new URL(inicio.headers.location)
  const nonce = destino.searchParams.get('nonce')
  const state = destino.searchParams.get('state')
  const extra = semPermissao ? '|sem_calendario' : ''
  return sessao.agent
    .get('/api/calendario/callback')
    .query({ code: `${sessao.sub}|${sessao.usuario.email}|${nonce}${extra}`, state })
}

export async function sincronizar(c) {
  return (await c.post('/api/calendario/sincronizar', { forcar: true })).body
}
