// Acesso às tarefas da conta (API). As tarefas são independentes dos eventos do Google Calendar.
import { api } from './api.js'

export const tarefasApi = {
  async listar() {
    const { tarefas } = await api.get('/tarefas')
    return tarefas.map((t) => ({ ...t, dias: t.dias ?? [], concluidas: t.concluidas ?? {} }))
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
  }
}
