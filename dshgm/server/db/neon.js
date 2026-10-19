import { neon } from '@neondatabase/serverless'

// Cliente HTTP do Neon: cada consulta é uma requisição HTTPS independente, sem conexões persistentes.
// É o modelo adequado a funções serverless (não há pool nem sockets para vazar entre execuções).
// Consequência de projeto: sem transações interativas. As operações compostas usam uma única
// instrução SQL (CTEs) ou são idempotentes.
export function criarBancoNeon(connectionString) {
  if (!connectionString) throw new Error('DATABASE_URL não configurada.')
  const sql = neon(connectionString)
  return {
    async query(text, params = []) {
      const resultado = await sql.query(text, params)
      return Array.isArray(resultado) ? resultado : (resultado?.rows ?? [])
    }
  }
}
