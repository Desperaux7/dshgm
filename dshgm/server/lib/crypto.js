import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const sha256 = (texto) => createHash('sha256').update(texto).digest('hex')
export const tokenAleatorio = (bytes = 32) => randomBytes(bytes).toString('base64url')

export function iguaisSeguro(a, b) {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

/* ---------- Assinatura (cookie temporário do fluxo OAuth) ---------- */

export function assinar(objeto, segredo) {
  const corpo = Buffer.from(JSON.stringify(objeto)).toString('base64url')
  const mac = createHmac('sha256', segredo).update(corpo).digest('base64url')
  return `${corpo}.${mac}`
}

export function verificarAssinatura(valor, segredo) {
  if (typeof valor !== 'string') return null
  const [corpo, mac] = valor.split('.')
  if (!corpo || !mac) return null
  const esperado = createHmac('sha256', segredo).update(corpo).digest('base64url')
  if (!iguaisSeguro(mac, esperado)) return null
  try {
    return JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

/* ---------- AES-256-GCM (refresh token do Google) ---------- */

function chaveDe(base64) {
  const chave = Buffer.from(base64 ?? '', 'base64')
  if (chave.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY deve ter 32 bytes em base64.')
  return chave
}

export function criptografar(texto, chaveBase64) {
  const iv = randomBytes(12)
  const cifra = createCipheriv('aes-256-gcm', chaveDe(chaveBase64), iv)
  const dados = Buffer.concat([cifra.update(texto, 'utf8'), cifra.final()])
  return ['v1', iv.toString('base64url'), cifra.getAuthTag().toString('base64url'), dados.toString('base64url')].join('.')
}

export function descriptografar(valor, chaveBase64) {
  const [versao, iv, tag, dados] = String(valor).split('.')
  if (versao !== 'v1' || !iv || !tag || !dados) throw new Error('Formato de token criptografado inválido.')
  const decifra = createDecipheriv('aes-256-gcm', chaveDe(chaveBase64), Buffer.from(iv, 'base64url'))
  decifra.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decifra.update(Buffer.from(dados, 'base64url')), decifra.final()]).toString('utf8')
}

/* ---------- PKCE ---------- */

export const desafioPKCE = (verificador) => createHash('sha256').update(verificador).digest('base64url')
