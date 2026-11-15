// Times, subtimes e colaboradores da conta (API do modo profissional).
import { api } from './api.js'

const id = encodeURIComponent

export const timesApi = {
  async listar() {
    return (await api.get('/times')).times
  },
  async criarTime(dados) {
    return (await api.post('/times', dados)).time
  },
  async atualizarTime(timeId, dados) {
    return (await api.patch(`/times/${id(timeId)}`, dados)).time
  },
  async excluirTime(timeId) {
    await api.delete(`/times/${id(timeId)}`)
  },

  async criarSubtime(timeId, nome) {
    return (await api.post(`/times/${id(timeId)}/subtimes`, { nome })).subtime
  },
  async renomearSubtime(subId, nome) {
    return (await api.patch(`/times/subtimes/${id(subId)}`, { nome })).subtime
  },
  async excluirSubtime(subId) {
    await api.delete(`/times/subtimes/${id(subId)}`)
  },

  async criarColaborador(timeId, dados) {
    return (await api.post(`/times/${id(timeId)}/colaboradores`, dados)).colaborador
  },
  async atualizarColaborador(colabId, dados) {
    return (await api.patch(`/times/colaboradores/${id(colabId)}`, dados)).colaborador
  },
  async excluirColaborador(colabId) {
    await api.delete(`/times/colaboradores/${id(colabId)}`)
  }
}

export const TIPOS_EVENTO = [
  { id: 'feedback', nome: 'Feedback' },
  { id: 'reuniao', nome: 'Reunião' },
  { id: 'outro', nome: 'Outro' }
]

// Pontos de melhoria ainda não desenvolvidos.
export const melhoriasEmAberto = (colaborador) => colaborador.pontosMelhoria.filter((p) => !p.desenvolvido)

// Evento mais recente (por data) ou null.
export function ultimoEvento(colaborador) {
  return [...colaborador.eventos].sort((a, b) => b.data.localeCompare(a.data))[0] ?? null
}

// Agrupa os colaboradores de um time: os sem subtime primeiro, depois um grupo por subtime (mesmo vazio).
export function agruparPorSubtime(time) {
  const grupos = [{ subtime: null, colaboradores: time.colaboradores.filter((c) => !c.subtimeId) }]
  time.subtimes.forEach((subtime) => grupos.push({ subtime, colaboradores: time.colaboradores.filter((c) => c.subtimeId === subtime.id) }))
  return grupos
}

// Totais para a página inicial.
export function resumoDosTimes(times) {
  const colaboradores = times.flatMap((t) => t.colaboradores)
  return {
    times: times.length,
    colaboradores: colaboradores.length,
    melhoriasEmAberto: colaboradores.reduce((n, c) => n + melhoriasEmAberto(c).length, 0)
  }
}
