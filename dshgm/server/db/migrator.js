import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

// Aplica migrações SQL em ordem, uma única vez cada. Nunca remove nem reaplica.
// `executor` precisa de: exec(sql) para scripts com várias instruções e rows(sql, params) para consultas.
export async function aplicarMigracoes(executor, pasta, log = () => {}) {
  await executor.exec(`
    create table if not exists schema_migrations (
      version    text primary key,
      checksum   text not null,
      applied_at timestamptz not null default now()
    )`)

  const aplicadas = new Map((await executor.rows('select version, checksum from schema_migrations')).map((r) => [r.version, r.checksum]))
  const arquivos = (await readdir(pasta)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort()
  const novas = []

  for (const arquivo of arquivos) {
    const sql = await readFile(join(pasta, arquivo), 'utf8')
    const checksum = createHash('sha256').update(sql).digest('hex')

    if (aplicadas.has(arquivo)) {
      if (aplicadas.get(arquivo) !== checksum) {
        throw new Error(`A migração ${arquivo} já foi aplicada e foi alterada depois. Crie uma nova migração em vez de editá-la.`)
      }
      continue
    }

    log(`Aplicando ${arquivo}...`)
    await executor.exec(`begin;\n${sql}\ninsert into schema_migrations (version, checksum) values ('${arquivo}', '${checksum}');\ncommit;`)
    novas.push(arquivo)
  }
  return novas
}
