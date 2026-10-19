// Conversão entre o modelo de evento do dashboard e o recurso "Event" do Google Calendar.
// Funções puras (sem rede nem banco), cobertas por testes.
import { formatarNoFuso, hhmmDe, minutosDe, paredeParaUTC, somarDiasData } from '../lib/dates.js'

export const CATEGORIAS = ['pessoal', 'trabalho', 'estudos', 'saude', 'lazer']
const CODIGOS_DIA = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const FREQ_PARA_TIPO = { DAILY: 'diaria', WEEKLY: 'semanal', MONTHLY: 'mensal', YEARLY: 'anual' }
const TIPO_PARA_FREQ = { diaria: 'DAILY', semanal: 'WEEKLY', mensal: 'MONTHLY', anual: 'YEARLY' }

const semHifen = (data) => data.replaceAll('-', '')
const diaDaSemana = (data) => new Date(`${data}T12:00:00Z`).getUTCDay()
const doisDig = (n) => String(n).padStart(2, '0')

function formatoUTC(data) {
  return (
    `${data.getUTCFullYear()}${doisDig(data.getUTCMonth() + 1)}${doisDig(data.getUTCDate())}` +
    `T${doisDig(data.getUTCHours())}${doisDig(data.getUTCMinutes())}${doisDig(data.getUTCSeconds())}Z`
  )
}

/* ---------- Dashboard -> Google ---------- */

function fimDoEvento(e) {
  const inicio = minutosDe(e.inicio)
  if (e.fim && minutosDe(e.fim) > inicio) return e.fim
  return hhmmDe(Math.min(inicio + 60, 23 * 60 + 59))
}

export function regrasDeRecorrencia(e, fuso) {
  if (e.rec.tipo === 'nenhuma') return []
  let regra = `RRULE:FREQ=${TIPO_PARA_FREQ[e.rec.tipo]}`

  if (e.rec.tipo === 'semanal') {
    const dias = e.rec.dias.length ? e.rec.dias : [diaDaSemana(e.data)]
    regra += `;BYDAY=${dias.map((d) => CODIGOS_DIA[d]).join(',')}`
  }
  if (e.rec.ate) {
    regra += e.diaInteiro
      ? `;UNTIL=${semHifen(e.rec.ate)}`
      : `;UNTIL=${formatoUTC(paredeParaUTC(e.rec.ate, '23:59:59', fuso))}`
  }

  const linhas = [regra]
  const excecoes = [...new Set(e.excecoes)].sort()
  if (excecoes.length) {
    linhas.push(
      e.diaInteiro
        ? `EXDATE;VALUE=DATE:${excecoes.map(semHifen).join(',')}`
        : `EXDATE;TZID=${fuso}:${excecoes.map((d) => `${semHifen(d)}T${e.inicio.replace(':', '')}00`).join(',')}`
    )
  }
  return linhas
}

export function paraGoogle(e, fuso, { novo = false } = {}) {
  const corpo = {
    summary: e.titulo,
    description: e.notas || '',
    extendedProperties: { private: { dshgm: '1', dshgmCategoria: e.categoria } },
    recurrence: regrasDeRecorrencia(e, fuso)
  }

  // Lembretes: eventos novos usam os padrões do próprio Google Calendar (notificações nativas dos dispositivos).
  // Em atualizações não mexemos nos lembretes, para não apagar os personalizados no Google.
  if (novo) corpo.reminders = { useDefault: true }

  if (e.diaInteiro) {
    corpo.start = { date: e.data }
    corpo.end = { date: somarDiasData(e.data, 1) }
  } else {
    corpo.start = { dateTime: `${e.data}T${e.inicio}:00`, timeZone: fuso }
    corpo.end = { dateTime: `${e.data}T${fimDoEvento(e)}:00`, timeZone: fuso }
  }
  return corpo
}

// O Google aceita ids definidos pelo cliente com caracteres a-v e 0-9. UUID sem hífens atende,
// e como é determinístico, repetir o envio não cria duplicata (o Google responde 409).
export const googleIdDe = (uuid) => uuid.replaceAll('-', '').toLowerCase()

/* ---------- Google -> Dashboard ---------- */

function paraInstante(info, fusoPadrao) {
  const texto = info.dateTime
  if (/(?:[zZ]|[+-]\d{2}:\d{2})$/.test(texto)) return new Date(texto)
  const [data, hora] = texto.split('T')
  return paredeParaUTC(data, hora.slice(0, 8), info.timeZone || fusoPadrao)
}

function dataDeValor(valor, fuso) {
  // 20261021, 20261021T093000 ou 20261021T123000Z
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(valor)
  if (!m) return null
  if (m[7]) return formatarNoFuso(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])), fuso).data
  return `${m[1]}-${m[2]}-${m[3]}`
}

export function lerRecorrencia(linhas = [], fuso) {
  const vazio = { rec: { tipo: 'nenhuma', dias: [], ate: '' }, excecoes: [], naoSuportada: false }
  if (!linhas.length) return vazio

  const rrules = linhas.filter((l) => l.toUpperCase().startsWith('RRULE:'))
  const exdates = linhas.filter((l) => l.toUpperCase().startsWith('EXDATE'))
  const outros = linhas.filter((l) => /^(RDATE|EXRULE)/i.test(l))
  if (!rrules.length) return vazio

  const resultado = { ...vazio, rec: { ...vazio.rec } }
  const partes = Object.fromEntries(
    rrules[0]
      .slice(6)
      .split(';')
      .map((p) => p.split('='))
      .filter((p) => p.length === 2)
      .map(([k, v]) => [k.toUpperCase(), v])
  )

  const tipo = FREQ_PARA_TIPO[partes.FREQ]
  let suportada = Boolean(tipo) && rrules.length === 1 && outros.length === 0
  resultado.rec.tipo = tipo ?? 'nenhuma'

  if ('COUNT' in partes) suportada = false
  if ('INTERVAL' in partes && partes.INTERVAL !== '1') suportada = false
  for (const chave of ['BYMONTHDAY', 'BYMONTH', 'BYSETPOS', 'BYYEARDAY', 'BYWEEKNO', 'BYHOUR', 'BYMINUTE']) {
    if (chave in partes) suportada = false
  }

  if ('BYDAY' in partes) {
    const dias = partes.BYDAY.split(',').map((c) => CODIGOS_DIA.indexOf(c))
    if (tipo !== 'semanal' || dias.some((d) => d < 0)) suportada = false
    else resultado.rec.dias = [...new Set(dias)].sort((a, b) => a - b)
  }
  if (partes.UNTIL) {
    const ate = dataDeValor(partes.UNTIL, fuso)
    if (ate) resultado.rec.ate = ate
    else suportada = false
  }

  const excecoes = new Set()
  for (const linha of exdates) {
    const valores = linha.slice(linha.indexOf(':') + 1).split(',')
    for (const v of valores) {
      const dia = dataDeValor(v.trim(), fuso)
      if (dia) excecoes.add(dia)
    }
  }
  resultado.excecoes = [...excecoes].sort()
  resultado.naoSuportada = !suportada
  return resultado
}

export function deGoogle(g, fuso) {
  if (!g?.start || !g?.end) return null
  // Aniversários, foco, fora do escritório etc. não são tratados pelo dashboard.
  if (g.eventType && g.eventType !== 'default') return null

  const base = { titulo: String(g.summary || '(Sem título)').slice(0, 200), notas: String(g.description || '').slice(0, 4000) }
  const categoria = g.extendedProperties?.private?.dshgmCategoria
  const comum = {
    ...base,
    categoria: CATEGORIAS.includes(categoria) ? categoria : undefined,
    ...lerRecorrencia(g.recurrence, fuso)
  }

  if (g.start.date) {
    return { ...comum, data: g.start.date, diaInteiro: true, inicio: '', fim: '' }
  }
  if (!g.start.dateTime || !g.end.dateTime) return null

  const inicio = formatarNoFuso(paraInstante(g.start, fuso), fuso)
  const fim = formatarNoFuso(paraInstante(g.end, fuso), fuso)
  return {
    ...comum,
    data: inicio.data,
    diaInteiro: false,
    inicio: inicio.hora,
    // Eventos que atravessam a meia-noite são truncados em 23:59 (o dashboard guarda um único dia).
    fim: fim.data === inicio.data ? fim.hora : '23:59'
  }
}

// Data (no fuso do usuário) da ocorrência original de uma instância alterada ou cancelada.
export function diaOriginal(g, fuso) {
  const o = g.originalStartTime
  if (!o) return null
  if (o.date) return o.date
  if (!o.dateTime) return null
  return formatarNoFuso(paraInstante(o, fuso), fuso).data
}
