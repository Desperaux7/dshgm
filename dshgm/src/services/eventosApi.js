// Eventos da agenda da conta (API). A propagação ao Google Calendar é feita pelo servidor.
import { api } from './api.js'

export const eventosApi = {
  async listar() {
    return (await api.get('/eventos')).eventos
  },
  async criar(dados) {
    return (await api.post('/eventos', dados)).evento
  },
  async atualizar(id, dados) {
    return (await api.patch(`/eventos/${encodeURIComponent(id)}`, dados)).evento
  },
  async excluir(id) {
    await api.delete(`/eventos/${encodeURIComponent(id)}`)
  }
}
