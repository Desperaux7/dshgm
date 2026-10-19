// Utilitários de datas e fusos horários (sem dependências externas).

export function somarDiasData(dataStr, dias) {
  const [a, m, d] = dataStr.split('-').map(Number)
  const dt = new Date(Date.UTC(a, m - 1, d + dias))
  return dt.toISOString().slice(0, 10)
}

function partesNoFuso(instante, fuso) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
  const p = Object.fromEntries(fmt.formatToParts(instante).map((x) => [x.type, x.value]))
  return { data: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}`, segundo: p.second }
}

// Instante -> data (AAAA-MM-DD) e hora (HH:MM) no fuso informado.
export function formatarNoFuso(instante, fuso) {
  const { data, hora } = partesNoFuso(instante, fuso)
  return { data, hora }
}

function deslocamentoMs(instante, fuso) {
  const p = partesNoFuso(instante, fuso)
  const [a, m, d] = p.data.split('-').map(Number)
  const [h, mi] = p.hora.split(':').map(Number)
  const comoUTC = Date.UTC(a, m - 1, d, h, mi, Number(p.segundo))
  return comoUTC - Math.floor(instante.getTime() / 1000) * 1000
}

// Data/hora "de parede" em um fuso -> instante UTC (duas passagens tratam mudanças de horário de verão).
export function paredeParaUTC(dataStr, horaStr, fuso) {
  const [a, m, d] = dataStr.split('-').map(Number)
  const [h, mi, s = 0] = horaStr.split(':').map(Number)
  const palpite = Date.UTC(a, m - 1, d, h, mi, s)
  let t = palpite - deslocamentoMs(new Date(palpite), fuso)
  t = palpite - deslocamentoMs(new Date(t), fuso)
  return new Date(t)
}

export function fusoValido(fuso) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: fuso })
    return typeof fuso === 'string' && fuso.length <= 64
  } catch {
    return false
  }
}

export const minutosDe = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export const hhmmDe = (minutos) =>
  `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`
