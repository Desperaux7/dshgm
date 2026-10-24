import { HttpError } from '../lib/errors.js'

export function naoEncontradaRota(_req, _res, next) {
  next(new HttpError(404, 'rota_inexistente', 'Rota não encontrada.'))
}

// Tratador central: formato de erro único e sem vazamento de detalhes internos.
// eslint-disable-next-line no-unused-vars
export function tratarErros(erro, req, res, _next) {
  if (res.headersSent) return

  if (erro instanceof HttpError) {
    return res.status(erro.status).json({ erro: { codigo: erro.codigo, mensagem: erro.message, detalhes: erro.detalhes } })
  }
  if (erro?.type === 'entity.too.large') {
    return res.status(413).json({ erro: { codigo: 'corpo_grande', mensagem: 'Conteúdo grande demais.' } })
  }
  if (erro?.type === 'entity.parse.failed' || erro instanceof SyntaxError) {
    return res.status(400).json({ erro: { codigo: 'json_invalido', mensagem: 'JSON inválido.' } })
  }

  // Registra só o essencial: sem corpo da requisição, cabeçalhos, cookies ou tokens.
  console.error(`[erro] ${req.method} ${req.path}: ${erro?.name ?? 'Error'}: ${String(erro?.message ?? erro).slice(0, 300)}`)
  res.status(500).json({ erro: { codigo: 'erro_interno', mensagem: 'Erro interno. Tente novamente.' } })
}
