// Aplica as migrações em db/migrations no banco apontado por DATABASE_URL.
//   npm run migrate
// Usa WebSocket (Pool do Neon) porque o modo HTTP não aceita scripts com várias instruções.
import { fileURLToPath } from 'node:url'
import { Pool, neonConfig } from '@neondatabase/serverless'
import { aplicarMigracoes } from '../server/db/migrator.js'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL não definida. Configure o .env (veja .env.example).')
  process.exit(1)
}

// Node >= 22 tem WebSocket global; no Node 20 é preciso informar a implementação.
if (typeof WebSocket === 'undefined') {
  const { default: ws } = await import('ws')
  neonConfig.webSocketConstructor = ws
}

const pasta = fileURLToPath(new URL('../db/migrations', import.meta.url))
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

try {
  const novas = await aplicarMigracoes(
    {
      exec: (sql) => pool.query(sql),
      rows: async (sql, params) => (await pool.query(sql, params)).rows
    },
    pasta,
    (msg) => console.log(msg)
  )
  console.log(novas.length ? `Concluído: ${novas.length} migração(ões) aplicada(s).` : 'Banco já está atualizado.')
} catch (erro) {
  console.error('Falha ao aplicar migrações:', erro.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
