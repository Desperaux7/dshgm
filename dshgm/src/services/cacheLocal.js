// Cache local de dados da conta (hoje: só preferências, para evitar "piscar" a cor padrão ao abrir a página).
// O cache sempre pertence a UMA conta: se outra conta entrar no mesmo navegador, ele é descartado
// em vez de ser copiado para a conta errada.

export const CHAVE_DONO = 'dshgm-cache-dono'
export const CHAVES_CACHE = ['dashboard-preferencias', 'dashboard-preferencias-pendente']

export function donoDoCache(armazenamento = localStorage) {
  try {
    return armazenamento.getItem(CHAVE_DONO)
  } catch {
    return null
  }
}

export function definirDonoDoCache(userId, armazenamento = localStorage) {
  try {
    armazenamento.setItem(CHAVE_DONO, userId)
  } catch {
    /* sem armazenamento: o app funciona, só não há cache */
  }
}

export function limparCache(armazenamento = localStorage) {
  for (const chave of [...CHAVES_CACHE, CHAVE_DONO]) {
    try {
      armazenamento.removeItem(chave)
    } catch {
      /* ignora */
    }
  }
}
