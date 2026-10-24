// Conexão e sincronização com o Google Calendar (API).
import { api } from './api.js'

export const URL_CONECTAR = '/api/calendario/conectar'

export const calendarioApi = {
  // { conectado, estado, email, ultimaSincronizacao, erro, eventosPorEstado }
  status: () => api.get('/calendario/status'),
  // { estado: 'ok'|'recente'|'em_andamento'|'desconectado'|'erro', resumo?, mensagem?, status }
  sincronizar: (forcar = false) => api.post('/calendario/sincronizar', { forcar }),
  async desconectar() {
    await api.delete('/calendario/conexao')
  }
}

// Houve alteração local causada pela sincronização? (para redesenhar a agenda)
export function mudouAgenda(resposta) {
  const r = resposta?.resumo
  return Boolean(r && resposta.estado === 'ok' && r.criados + r.atualizados + r.removidos + r.excecoes + r.enviados > 0)
}
