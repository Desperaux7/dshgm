// Favoritos da conta (API): links, pastas e categorias.
import { api } from './api.js'

const id = encodeURIComponent

export const favoritosApi = {
  async listar() {
    return (await api.get('/favoritos')).favoritos
  },
  // Links e pastas na mesma resposta.
  async listarTudo() {
    const { favoritos, pastas } = await api.get('/favoritos')
    return { favoritos, pastas: pastas ?? [] }
  },
  async criar(dados) {
    return (await api.post('/favoritos', dados)).favorito
  },
  async atualizar(favId, dados) {
    return (await api.patch(`/favoritos/${id(favId)}`, dados)).favorito
  },
  async excluir(favId) {
    await api.delete(`/favoritos/${id(favId)}`)
  },

  async criarPasta(dados) {
    return (await api.post('/favoritos/pastas', dados)).pasta
  },
  async atualizarPasta(pastaId, dados) {
    return (await api.patch(`/favoritos/pastas/${id(pastaId)}`, dados)).pasta
  },
  async excluirPasta(pastaId) {
    await api.delete(`/favoritos/pastas/${id(pastaId)}`)
  },

  // Só categorias criadas pelo usuário (as padrão são fixas).
  async renomearCategoria(de, para) {
    return api.patch('/favoritos/categorias', { de, para })
  },
  async excluirCategoria(nome) {
    return api.delete(`/favoritos/categorias?nome=${id(nome)}`)
  }
}
