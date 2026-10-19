// Acesso ao financeiro da conta (API). Valores monetários trafegam como números com 2 casas;
// somas e saldos oficiais são calculados no servidor com aritmética exata.
import { api } from './api.js'

const PAGINA = 2000

export const financeiroApi = {
  // Busca todas as movimentações, página a página.
  async listar() {
    const todas = []
    for (let offset = 0; ; offset += PAGINA) {
      const { transacoes } = await api.get(`/transacoes?limite=${PAGINA}&offset=${offset}`)
      todas.push(...transacoes)
      if (transacoes.length < PAGINA) return todas
    }
  },
  async criar(dados) {
    return (await api.post('/transacoes', dados)).transacao
  },
  async excluir(id) {
    await api.delete(`/transacoes/${encodeURIComponent(id)}`)
  },
  async obterMeta() {
    return (await api.get('/meta')).meta
  },
  async salvarMeta(meta) {
    return (await api.put('/meta', meta)).meta
  },
  async removerMeta() {
    await api.delete('/meta')
  },
  // { mes, entradas, despesas, guardado, saldo, totalGuardado }
  async resumo(mes) {
    return (await api.get(`/transacoes/resumo?mes=${mes}`)).resumo
  }
}
