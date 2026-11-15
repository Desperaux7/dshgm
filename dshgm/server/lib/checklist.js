// Regra da checklist de uma tarefa, para um dia:
//   todos os itens marcados  -> a tarefa fica concluída;
//   alguns marcados          -> em andamento;
//   nenhum marcado           -> se estava concluída, volta a pendente.
// `desmarcou`: o usuário acabou de desmarcar um item. Sem nenhum item marcado, a tarefa volta a pendente mesmo que
// estivesse em andamento. Em outras situações (ex.: editar o texto da checklist) um andamento escolhido à mão é mantido.
// Sem itens, a checklist não decide nada (o estado da tarefa continua sendo o que o usuário definiu).
export function statusPelaChecklist(atual, total, feitos, { desmarcou = false } = {}) {
  if (total <= 0) return atual
  if (feitos >= total) return 'concluida'
  if (feitos > 0) return 'andamento'
  if (atual === 'concluida') return 'pendente'
  return desmarcou ? 'pendente' : atual
}

export function statusDoDia(tarefa, dia) {
  if (tarefa.concluidas?.[dia]) return 'concluida'
  if (tarefa.andamento?.[dia]) return 'andamento'
  return 'pendente'
}

export function contarChecklist(tarefa, dia) {
  const itens = tarefa.checklist ?? []
  return { total: itens.length, feitos: itens.filter((i) => i.feitos?.[dia]).length }
}
