// Acesso às tarefas da conta (API). As tarefas são independentes dos eventos do Google Calendar.
import { api } from './api.js'

export const tarefasApi = {
  async listar() {
    const { tarefas } = await api.get('/tarefas')
    return tarefas.map((t) => ({ ...t, dias: t.dias ?? [], concluidas: t.concluidas ?? {}, andamento: t.andamento ?? {} }))
  },
  async criar(dados) {
    return (await api.post('/tarefas', dados)).tarefa
  },
  async atualizar(id, campos) {
    return (await api.patch(`/tarefas/${encodeURIComponent(id)}`, campos)).tarefa
  },
  async excluir(id) {
    await api.delete(`/tarefas/${encodeURIComponent(id)}`)
  },
  async concluir(id, dia, concluida) {
    return (await api.put(`/tarefas/${encodeURIComponent(id)}/concluidas/${dia}`, { concluida })).tarefa
  },
  // status: 'pendente' | 'andamento' | 'concluida' (um por dia da tarefa)
  async definirStatus(id, dia, status) {
    return (await api.put(`/tarefas/${encodeURIComponent(id)}/status/${dia}`, { status })).tarefa
  }
}

// Estado de uma tarefa em um dia: 'pendente' | 'andamento' | 'concluida' (concluída vence andamento).
export function statusDoDia(tarefa, chave) {
  if (tarefa.concluidas?.[chave]) return 'concluida'
  if (tarefa.andamento?.[chave]) return 'andamento'
  return 'pendente'
}
