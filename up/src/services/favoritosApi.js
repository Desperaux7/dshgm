// Favoritos da conta (API).
import { api } from './api.js'

export const favoritosApi = {
  async listar() {
    return (await api.get('/favoritos')).favoritos
  },
  async criar(dados) {
    return (await api.post('/favoritos', dados)).favorito
  },
  async atualizar(id, dados) {
    return (await api.patch(`/favoritos/${encodeURIComponent(id)}`, dados)).favorito
  },
  async excluir(id) {
    await api.delete(`/favoritos/${encodeURIComponent(id)}`)
  }
}
