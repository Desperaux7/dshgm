// Erros HTTP previsíveis. O tratador central converte para JSON consistente.
export class HttpError extends Error {
  constructor(status, codigo, mensagem, detalhes) {
    super(mensagem)
    this.status = status
    this.codigo = codigo
    this.detalhes = detalhes
  }
}

export const requisicaoInvalida = (mensagem = 'Requisição inválida.', detalhes) =>
  new HttpError(400, 'requisicao_invalida', mensagem, detalhes)
export const naoAutenticado = (mensagem = 'Autenticação necessária.') =>
  new HttpError(401, 'nao_autenticado', mensagem)
export const proibido = (mensagem = 'Ação não permitida.') => new HttpError(403, 'proibido', mensagem)
export const naoEncontrado = (mensagem = 'Registro não encontrado.') =>
  new HttpError(404, 'nao_encontrado', mensagem)
export const conflito = (mensagem = 'Conflito com o estado atual do recurso.') =>
  new HttpError(409, 'conflito', mensagem)

// Express 4 não captura rejeições de handlers async; este wrapper repassa o erro ao middleware de erros.
export const assincrono = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next)
}
