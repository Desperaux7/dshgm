import { chaveData, dataDeChave, somarDias } from '../services/storage.js'
import { eventosApi } from '../services/eventosApi.js'

export const CATEGORIAS_EVENTO = [
  { id: 'pessoal', nome: 'Pessoal', cor: '#5eead4' },
  { id: 'trabalho', nome: 'Trabalho', cor: '#60a5fa' },
  { id: 'estudos', nome: 'Estudos', cor: '#34d399' },
  { id: 'saude', nome: 'Saúde', cor: '#f4909c' },
  { id: 'lazer', nome: 'Lazer', cor: '#fbbf24' }
]

export const RECORRENCIAS = [
  { id: 'nenhuma', nome: 'Não se repete' },
  { id: 'diaria', nome: 'Todos os dias' },
  { id: 'semanal', nome: 'Toda semana' },
  { id: 'mensal', nome: 'Todo mês' },
  { id: 'anual', nome: 'Todo ano' }
]

export const DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
export const DIAS_LONGOS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
export const MESES_LONGOS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
]
export const MESES_CURTOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

export const categoriaDe = (id) => CATEGORIAS_EVENTO.find((c) => c.id === id) ?? CATEGORIAS_EVENTO[0]

/*
  Modelo de evento:
  {
    id, titulo, data: 'AAAA-MM-DD',          // data da primeira ocorrência
    diaInteiro, inicio: 'HH:MM', fim: 'HH:MM',
    categoria, notas,
    rec: { tipo, dias: [0..6], ate: 'AAAA-MM-DD' | '' },   // dias: só para "semanal"
    excecoes: ['AAAA-MM-DD'],                 // ocorrências excluídas individualmente
    sincronizacao: { estado, erro, somenteLeitura }   // situação no Google Calendar (vem do servidor)
  }
*/

// Eventos da conta (o servidor valida, normaliza e propaga ao Google Calendar quando conectado).
export const carregarEventos = () => eventosApi.listar()

/* ---------- Recorrência ---------- */

const diasNoMes = (ano, mes) => new Date(ano, mes, 0).getDate() // mes: 1-12

// O evento acontece na data "chave"?
export function ocorreEm(evento, chave) {
  if (chave < evento.data) return false
  if (evento.rec.ate && chave > evento.rec.ate) return false
  if (evento.excecoes.includes(chave)) return false

  const tipo = evento.rec.tipo
  if (tipo === 'nenhuma') return chave === evento.data
  if (tipo === 'diaria') return true

  const dia = dataDeChave(chave)
  const base = dataDeChave(evento.data)

  if (tipo === 'semanal') {
    const dias = evento.rec.dias.length ? evento.rec.dias : [base.getDay()]
    return dias.includes(dia.getDay())
  }

  if (tipo === 'mensal') {
    // Dia 31 em um mês de 30 dias acontece no último dia do mês.
    const alvo = Math.min(base.getDate(), diasNoMes(dia.getFullYear(), dia.getMonth() + 1))
    return dia.getDate() === alvo
  }

  if (tipo === 'anual') {
    if (dia.getMonth() !== base.getMonth()) return false
    const alvo = Math.min(base.getDate(), diasNoMes(dia.getFullYear(), dia.getMonth() + 1))
    return dia.getDate() === alvo
  }

  return false
}

const ordemHorario = (a, b) => {
  if (a.diaInteiro !== b.diaInteiro) return a.diaInteiro ? -1 : 1
  return a.inicio.localeCompare(b.inicio) || a.titulo.localeCompare(b.titulo, 'pt-BR')
}

export const eventosDoDia = (eventos, chave) => eventos.filter((e) => ocorreEm(e, chave)).sort(ordemHorario)

// Próximas ocorrências a partir de agora (eventos de hoje que já terminaram ficam de fora).
export function proximasOcorrencias(eventos, { limite = 4, dias = 370, agora = new Date() } = {}) {
  const hoje = chaveData(agora)
  const hora = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`
  const resultado = []

  for (let i = 0; i <= dias && resultado.length < limite; i++) {
    const chave = somarDias(hoje, i)
    for (const evento of eventosDoDia(eventos, chave)) {
      if (i === 0 && !evento.diaInteiro && (evento.fim || evento.inicio) < hora) continue
      resultado.push({ evento, data: chave })
      if (resultado.length >= limite) break
    }
  }
  return resultado
}

/* ---------- Textos ---------- */

export function descreverHorario(evento) {
  if (evento.diaInteiro) return 'Dia inteiro'
  return evento.fim ? `${evento.inicio} – ${evento.fim}` : evento.inicio
}

export function descreverRecorrencia(evento) {
  const { tipo, dias } = evento.rec
  if (tipo === 'nenhuma') return ''
  if (tipo === 'semanal' && dias.length && dias.length < 7) return dias.map((d) => DIAS_CURTOS[d]).join(', ')
  return RECORRENCIAS.find((r) => r.id === tipo).nome
}

export function rotuloDia(chave, hoje = chaveData()) {
  if (chave === hoje) return 'Hoje'
  if (chave === somarDias(hoje, 1)) return 'Amanhã'
  const d = dataDeChave(chave)
  return `${DIAS_CURTOS[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')} ${MESES_CURTOS[d.getMonth()]}`
}
