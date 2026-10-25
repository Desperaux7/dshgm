import { api } from './api.js'

// Lista de desejos. Toda resposta que altera a lista traz `totais` já recalculados pelo servidor.
export const desejosApi = {
  listar: () => api.get('/desejos'), // { itens, totais }
  criar: (dados) => api.post('/desejos', dados), // { item, totais }
  atualizar: (id, dados) => api.patch(`/desejos/${encodeURIComponent(id)}`, dados), // { item, totais }
  excluir: (id) => api.delete(`/desejos/${encodeURIComponent(id)}`) // { totais }
}
