import { obterServidor } from '../../server/index.js'

// Agendador do Netlify: sincroniza as contas conectadas a cada 15 minutos.
// Não é "tempo real": mudanças feitas no Google aparecem em até ~15 min (ou ao abrir o dashboard).
export default async () => {
  const { calendario } = obterServidor()
  const resultados = await calendario.sincronizarTodos({ limite: 25, tempoMaxMs: 20000 })
  console.log(`[calendar-sync] contas processadas: ${resultados.length}`)
  return new Response(null, { status: 204 })
}

export const config = { schedule: '*/15 * * * *' }
