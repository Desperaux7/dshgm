import rateLimit from 'express-rate-limit'

// Em ambiente serverless cada instância tem sua própria memória: este limite é uma barreira de
// atrito contra abuso simples, não uma garantia global. Para limite global use o do Netlify/WAF.
function chaveDoCliente(req) {
  return req.get('x-nf-client-connection-ip') ?? req.ip ?? 'desconhecido'
}

export function criarLimitadores({ habilitado = true } = {}) {
  const passa = (_req, _res, next) => next()
  if (!habilitado) return { geral: passa, autenticacao: passa, sincronizacao: passa, importacao: passa }

  const fabricar = (windowMs, limit, mensagem) =>
    rateLimit({
      windowMs,
      limit,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      keyGenerator: chaveDoCliente,
      validate: { trustProxy: false, xForwardedForHeader: false, keyGeneratorIpFallback: false },
      handler: (_req, res) =>
        res.status(429).json({ erro: { codigo: 'limite_excedido', mensagem } })
    })

  return {
    geral: fabricar(60_000, 300, 'Muitas requisições. Aguarde um instante.'),
    autenticacao: fabricar(10 * 60_000, 30, 'Muitas tentativas de login. Aguarde alguns minutos.'),
    sincronizacao: fabricar(60_000, 10, 'Sincronizações demais. Aguarde um minuto.'),
    importacao: fabricar(10 * 60_000, 10, 'Importações demais. Aguarde alguns minutos.')
  }
}
