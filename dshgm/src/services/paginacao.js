// Paginação simples: número de páginas e a faixa de itens da página, com a página corrigida para caber no total
// (ex.: depois de excluir o último item da última página).
export const TAMANHO_PAGINA = 10

export function paginar(total, pagina, tamanho = TAMANHO_PAGINA) {
  const paginas = Math.max(1, Math.ceil(total / tamanho))
  const atual = Math.min(Math.max(1, Number(pagina) || 1), paginas)
  return { paginas, atual, inicio: (atual - 1) * tamanho, fim: Math.min(atual * tamanho, total) }
}
