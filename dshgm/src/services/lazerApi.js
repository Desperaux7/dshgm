// Biblioteca de lazer da conta (API), incluindo as capas (imagens JPEG/PNG/WebP).
import { api } from './api.js'

export const lazerApi = {
  async listar() {
    return (await api.get('/lazer')).itens
  },
  async criar(dados) {
    return (await api.post('/lazer', dados)).item
  },
  async atualizar(id, dados) {
    return (await api.patch(`/lazer/${encodeURIComponent(id)}`, dados)).item
  },
  async excluir(id) {
    await api.delete(`/lazer/${encodeURIComponent(id)}`)
  },
  async enviarCapa(id, blob, { largura, altura }) {
    return (await api.enviarImagem(`/lazer/${encodeURIComponent(id)}/capa`, blob, { largura, altura })).item
  },
  async removerCapa(id) {
    return (await api.delete(`/lazer/${encodeURIComponent(id)}/capa`)).item
  },
  // Baixa a imagem da capa (a rota exige a sessão, então não dá para usar <img src> direto com segurança de cache).
  async lerCapaBlob(id) {
    const resp = await fetch(`/api/lazer/${encodeURIComponent(id)}/capa`, { credentials: 'same-origin' })
    if (resp.status === 404) return null
    if (!resp.ok) throw new Error('Não foi possível carregar a capa.')
    return resp.blob()
  }
}
