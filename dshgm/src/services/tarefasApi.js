// Acesso às tarefas da conta (API). As tarefas são independentes dos eventos do Google Calendar.
import { api } from './api.js'

export const tarefasApi = {
  async listar() {
    const { tarefas } = await api.get('/tarefas')
    return tarefas.map((t) => ({ ...t, dias: t.dias ?? [], concluidas: t.concluidas ?? {}, andamento: t.andamento ?? {}, checklist: t.checklist ?? [] }))
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
  },
  // Marca/desmarca um item da checklist no dia. O servidor devolve a tarefa já com o estado do dia atualizado.
  async marcarItem(id, itemId, dia, feito) {
    return (await api.put(`/tarefas/${encodeURIComponent(id)}/checklist/${encodeURIComponent(itemId)}/${dia}`, { feito })).tarefa
  }
}

// Itens da checklist de uma tarefa em um dia: { total, feitos }.
export function resumoChecklist(tarefa, chave) {
  const itens = tarefa.checklist ?? []
  return { total: itens.length, feitos: itens.filter((i) => i.feitos?.[chave]).length }
}

// Mesma regra do servidor (server/lib/checklist.js), usada para atualizar a tela na hora:
// todos marcados = concluída; alguns = em andamento; nenhum = pendente (quando acabou de desmarcar).
export function statusPelaChecklist(atual, total, feitos, { desmarcou = false } = {}) {
  if (total <= 0) return atual
  if (feitos >= total) return 'concluida'
  if (feitos > 0) return 'andamento'
  if (atual === 'concluida') return 'pendente'
  return desmarcou ? 'pendente' : atual
}

// Estado de uma tarefa em um dia: 'pendente' | 'andamento' | 'concluida' (concluída vence andamento).
export function statusDoDia(tarefa, chave) {
  if (tarefa.concluidas?.[chave]) return 'concluida'
  if (tarefa.andamento?.[chave]) return 'andamento'
  return 'pendente'
}
