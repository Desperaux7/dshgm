// Encerramento de sessão compartilhado pelos botões "Sair" (menu lateral e painel de perfil).
import { sair } from './api.js'
import { limparCache } from './cacheLocal.js'

export async function encerrarSessao() {
  await sair() // invalida a sessão no servidor
  limparCache() // não deixa preferências da conta em um navegador compartilhado
  window.location.assign('/')
}
