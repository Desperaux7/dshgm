import { carregarConfig } from './config.js'
import { criarBancoNeon } from './db/neon.js'
import { criarApp } from './app.js'

// Instância reutilizada entre invocações "quentes" da função serverless.
let cache
export function obterServidor() {
  if (!cache) {
    const config = carregarConfig()
    cache = criarApp({ config, db: criarBancoNeon(config.databaseUrl) })
  }
  return cache
}
