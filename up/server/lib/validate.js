import { z } from 'zod'
import { HttpError, naoEncontrado } from './errors.js'

export function validar(schema, dados) {
  const resultado = schema.safeParse(dados)
  if (!resultado.success) {
    const detalhes = resultado.error.issues.slice(0, 10).map((i) => ({
      campo: i.path.join('.'),
      mensagem: i.message
    }))
    throw new HttpError(400, 'validacao', 'Dados inválidos.', detalhes)
  }
  return resultado.data
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// Parâmetro de rota inválido é tratado como "não encontrado" (não revela nada sobre outros usuários).
export function uuidDaRota(valor) {
  if (typeof valor !== 'string' || !UUID.test(valor)) throw naoEncontrado()
  return valor.toLowerCase()
}

export function dataValida(texto) {
  if (typeof texto !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false
  const [a, m, d] = texto.split('-').map(Number)
  const data = new Date(Date.UTC(a, m - 1, d))
  return data.getUTCFullYear() === a && data.getUTCMonth() === m - 1 && data.getUTCDate() === d
}

/* ---------- Blocos reutilizáveis de schema ---------- */

export const zData = z.string().refine(dataValida, 'Data inválida (use AAAA-MM-DD).')
export const zHora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (use HH:MM).')
export const zDiasSemana = z
  .array(z.number().int().min(0).max(6))
  .max(7)
  .transform((dias) => [...new Set(dias)].sort((a, b) => a - b))

// Dinheiro: positivo, no máximo 2 casas decimais após arredondar.
export const zValor = z
  .number({ invalid_type_error: 'Valor inválido.' })
  .finite()
  .positive('O valor deve ser maior que zero.')
  .max(999999999.99)
  .transform((v) => Math.round(v * 100) / 100)

export const zUrlHttp = z
  .string()
  .max(2000)
  .refine((v) => {
    try {
      const u = new URL(v)
      return u.protocol === 'http:' || u.protocol === 'https:'
    } catch {
      return false
    }
  }, 'URL inválida (somente http e https).')

// Strings sem espaços nas pontas e sem caracteres de controle.
export const zTexto = (min, max) =>
  z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(min, 'Campo obrigatório.').max(max, `Máximo de ${max} caracteres.`))
    .refine((s) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s), 'Caracteres inválidos.')
