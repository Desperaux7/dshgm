import { describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { assinar, criptografar, descriptografar, verificarAssinatura } from '../server/lib/crypto.js'
import { formatarNoFuso, paredeParaUTC, somarDiasData } from '../server/lib/dates.js'
import { carregarConfig } from '../server/config.js'
import { destinoSeguro } from '../server/routes/auth.js'
import { aplicarMigracoes } from '../server/db/migrator.js'
import { deGoogle, googleIdDe, lerRecorrencia, paraGoogle } from '../server/services/eventMapping.js'
import { PASTA_MIGRACOES, envDeTeste } from './helpers.js'

const TZ = 'America/Sao_Paulo'

describe('criptografia', () => {
  const chave = randomBytes(32).toString('base64')
  it('AES-GCM: ida e volta, IV aleatório e adulteração detectada', () => {
    const a = criptografar('refresh-token', chave)
    expect(descriptografar(a, chave)).toBe('refresh-token')
    expect(criptografar('refresh-token', chave)).not.toBe(a)
    const adulterado = a.slice(0, -2) + (a.endsWith('AA') ? 'BB' : 'AA')
    expect(() => descriptografar(adulterado, chave)).toThrow()
    expect(() => descriptografar(a, randomBytes(32).toString('base64'))).toThrow()
    expect(() => criptografar('x', 'curta')).toThrow()
  })
  it('assinatura HMAC rejeita adulteração', () => {
    const t = assinar({ a: 1 }, 'segredo')
    expect(verificarAssinatura(t, 'segredo')).toEqual({ a: 1 })
    expect(verificarAssinatura(t, 'outro')).toBeNull()
    expect(verificarAssinatura(t.replace(/^./, 'Z'), 'segredo')).toBeNull()
    expect(verificarAssinatura(undefined, 'segredo')).toBeNull()
  })
})

describe('datas e fusos', () => {
  it('converte parede <-> UTC e soma dias', () => {
    expect(paredeParaUTC('2026-10-20', '09:30', TZ).toISOString()).toBe('2026-10-20T12:30:00.000Z')
    expect(formatarNoFuso(new Date('2026-10-20T02:30:00Z'), TZ)).toEqual({ data: '2026-10-19', hora: '23:30' })
    expect(somarDiasData('2026-12-31', 1)).toBe('2027-01-01')
    expect(somarDiasData('2028-02-28', 1)).toBe('2028-02-29')
  })
})

describe('mapeamento de eventos', () => {
  const base = { titulo: 'Aula', notas: '', data: '2026-10-19', diaInteiro: false, inicio: '19:30', fim: '21:00', categoria: 'estudos', rec: { tipo: 'semanal', dias: [1, 3], ate: '2026-12-18' }, excecoes: ['2026-10-26'] }
  it('ida e volta preserva o evento', () => {
    const g = paraGoogle(base, TZ, { novo: true })
    const volta = deGoogle({ ...g, start: { dateTime: '2026-10-19T19:30:00-03:00', timeZone: TZ }, end: { dateTime: '2026-10-19T21:00:00-03:00', timeZone: TZ } }, TZ)
    expect(volta).toMatchObject({ titulo: 'Aula', categoria: 'estudos', inicio: '19:30', fim: '21:00', rec: base.rec, excecoes: base.excecoes, naoSuportada: false })
  })
  it('só eventos novos recebem lembretes padrão (não sobrescreve os do Google)', () => {
    expect(paraGoogle(base, TZ, { novo: true }).reminders).toEqual({ useDefault: true })
    expect(paraGoogle(base, TZ).reminders).toBeUndefined()
  })
  it('sem horário de término usa +1h e nunca passa de 23:59', () => {
    expect(paraGoogle({ ...base, fim: '', rec: { tipo: 'nenhuma', dias: [], ate: '' }, excecoes: [] }, TZ).end.dateTime).toBe('2026-10-19T20:30:00')
    expect(paraGoogle({ ...base, inicio: '23:30', fim: '', rec: { tipo: 'nenhuma', dias: [], ate: '' }, excecoes: [] }, TZ).end.dateTime).toBe('2026-10-19T23:59:00')
  })
  it('classifica recorrências não suportadas', () => {
    for (const regra of ['RRULE:FREQ=WEEKLY;COUNT=5', 'RRULE:FREQ=MONTHLY;BYDAY=1MO', 'RRULE:FREQ=DAILY;INTERVAL=2', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=31', 'RRULE:FREQ=HOURLY']) {
      expect(lerRecorrencia([regra], TZ).naoSuportada, regra).toBe(true)
    }
    for (const regra of ['RRULE:FREQ=DAILY', 'RRULE:FREQ=WEEKLY;BYDAY=TU', 'RRULE:FREQ=YEARLY;UNTIL=20271231']) {
      expect(lerRecorrencia([regra], TZ).naoSuportada, regra).toBe(false)
    }
  })
  it('ids do Google são hexadecimais (aceitos pela API)', () => {
    expect(googleIdDe('0B0E9A1C-1111-4222-8333-444455556666')).toMatch(/^[a-v0-9]{32}$/)
  })
})

describe('redirecionamentos', () => {
  it('destinoSeguro só aceita caminhos relativos simples', () => {
    expect(destinoSeguro('/financeiro.html')).toBe('/financeiro.html')
    expect(destinoSeguro('/agenda.html')).toBe('/agenda.html')
    for (const mal of ['//evil.com', 'https://evil.com', '/\\evil', '/a/../b', 'javascript:1', '', undefined, 42, '/a?b=c', '/' + 'a'.repeat(200)]) {
      expect(destinoSeguro(mal), String(mal)).toBe('/')
    }
  })
})

describe('configuração de produção', () => {
  const prod = (extra = {}) => ({ ...envDeTeste(), NODE_ENV: 'production', APP_URL: 'https://meu-dash.netlify.app', DATABASE_URL: 'postgresql://x', ALLOWED_EMAILS: 'eu@exemplo.test', ...extra })
  it('aceita configuração completa e usa cookies __Host- e Secure', () => {
    const c = carregarConfig(prod())
    expect(c.sessao.cookie).toBe('__Host-sid')
    expect(c.producao).toBe(true)
    expect(c.google.loginRedirectUri).toBe('https://meu-dash.netlify.app/api/auth/google/callback')
    expect(c.google.calendarRedirectUri).toBe('https://meu-dash.netlify.app/api/calendario/callback')
  })
  it('falha cedo quando falta variável ou ela é fraca/insegura', () => {
    expect(() => carregarConfig(prod({ DATABASE_URL: '' }))).toThrow(/DATABASE_URL/)
    expect(() => carregarConfig(prod({ GOOGLE_CLIENT_SECRET: '' }))).toThrow(/GOOGLE_CLIENT_SECRET/)
    expect(() => carregarConfig(prod({ SESSION_SECRET: 'curto' }))).toThrow(/SESSION_SECRET/)
    expect(() => carregarConfig(prod({ TOKEN_ENCRYPTION_KEY: 'AAAA' }))).toThrow(/TOKEN_ENCRYPTION_KEY/)
    expect(() => carregarConfig(prod({ APP_URL: 'http://meu-dash.netlify.app' }))).toThrow(/https/)
    expect(() => carregarConfig(prod({ ALLOWED_EMAILS: '' }))).toThrow(/ALLOWED_EMAILS/)
    expect(() => carregarConfig(prod({ ALLOWED_EMAILS: 'sem-arroba, ,' }))).toThrow(/ALLOWED_EMAILS/)
  })
  it('normaliza a lista de e-mails permitidos (caixa e espaços)', () => {
    const c = carregarConfig(prod({ ALLOWED_EMAILS: ' Eu@Exemplo.test ,outro@x.test' }))
    expect([...c.emailsPermitidos]).toEqual(['eu@exemplo.test', 'outro@x.test'])
  })
  it('só origens configuradas podem escrever', () => {
    const c = carregarConfig(prod({ ALLOWED_ORIGINS: 'https://dash.exemplo.com, lixo' }))
    expect([...c.origensPermitidas].sort()).toEqual(['https://dash.exemplo.com', 'https://meu-dash.netlify.app'])
  })
})

describe('migrações', () => {
  const executor = (pg) => ({ exec: (s) => pg.exec(s), rows: async (s, p) => (await pg.query(s, p)).rows })
  it('aplicam uma vez, são idempotentes e criam todas as tabelas', async () => {
    const pg = new PGlite()
    const exec = executor(pg)
    const primeira = await aplicarMigracoes(exec, PASTA_MIGRACOES)
    expect(primeira.length).toBeGreaterThanOrEqual(4)
    expect(await aplicarMigracoes(exec, PASTA_MIGRACOES)).toEqual([])
    const tabelas = (await pg.query("select table_name from information_schema.tables where table_schema = 'public'")).rows.map((r) => r.table_name)
    for (const t of ['users', 'sessions', 'preferences', 'tasks', 'task_completions', 'transactions', 'financial_goals', 'favorites', 'leisure_items', 'leisure_covers', 'events', 'calendar_connections', 'import_runs']) {
      expect(tabelas, t).toContain(t)
    }
    await pg.close()
  })
  it('recusam migração já aplicada que foi alterada depois', async () => {
    const pg = new PGlite()
    const pasta = await mkdtemp(join(tmpdir(), 'mig-'))
    await writeFile(join(pasta, '001_a.sql'), 'create table a (id int);')
    await aplicarMigracoes(executor(pg), pasta)
    await writeFile(join(pasta, '001_a.sql'), 'create table a (id int, extra int);')
    await expect(aplicarMigracoes(executor(pg), pasta)).rejects.toThrow(/alterada/)
    await pg.close()
  })
  it('migrações são aditivas (nenhum DROP/TRUNCATE/DELETE)', async () => {
    const { readdir, readFile } = await import('node:fs/promises')
    for (const f of await readdir(PASTA_MIGRACOES)) {
      const sql = (await readFile(join(PASTA_MIGRACOES, f), 'utf8')).replace(/--.*$/gm, '')
      expect(sql, f).not.toMatch(/\b(drop|truncate|delete\s+from)\b/i)
    }
  })
  it('restrições do banco barram dados inválidos mesmo sem passar pela API', async () => {
    const pg = new PGlite()
    await aplicarMigracoes(executor(pg), PASTA_MIGRACOES)
    const [{ id }] = (await pg.query("insert into users (google_sub, email) values ('s','e@x.test') returning id")).rows
    await expect(pg.query("insert into transactions (user_id, type, description, category, amount, date) values ($1,'expense','x','y',-1,'2026-01-01')", [id])).rejects.toThrow()
    await expect(pg.query("insert into tasks (user_id, text, kind) values ($1,'x','unica')", [id])).rejects.toThrow() // única sem data
    await expect(pg.query("insert into favorites (user_id, name, url) values ($1,'x','javascript:alert(1)')", [id])).rejects.toThrow()
    await pg.close()
  })
})
