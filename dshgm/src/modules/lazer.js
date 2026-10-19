import { lazerApi } from '../services/lazerApi.js'

export const TIPOS = [
  { id: 'jogo', nome: 'Jogo', plural: 'Jogos', icone: 'gamepad', dica: 'PC, PS5, Switch, Xbox...' },
  { id: 'filme', nome: 'Filme', plural: 'Filmes', icone: 'film', dica: 'Cinema, Netflix, Max...' },
  { id: 'serie', nome: 'Série', plural: 'Séries', icone: 'tv', dica: 'Netflix, Prime Video...' }
]

export const STATUS = [
  { id: 'andamento', nome: 'Em andamento', plural: 'Em andamento' },
  { id: 'pendente', nome: 'Pendente', plural: 'Pendentes' },
  { id: 'concluido', nome: 'Concluído', plural: 'Concluídos' }
]

export const tipoDe = (id) => TIPOS.find((t) => t.id === id) ?? TIPOS[0]
export const statusDe = (id) => STATUS.find((s) => s.id === id) ?? STATUS[1]

/*
  Modelo de item da biblioteca:
  {
    id, tipo: 'jogo' | 'filme' | 'serie', titulo, plataforma,
    status: 'pendente' | 'andamento' | 'concluido',
    progresso: 0..100,                 // só jogos
    capa: { largura, altura, versao } | null,   // a imagem fica na conta (GET /api/lazer/:id/capa)
    criado, atualizado
  }
*/

// Mantém status e progresso coerentes entre si.
export function aplicarRegras(item, alterado) {
  const proximo = { ...item }
  if (proximo.tipo !== 'jogo') proximo.progresso = 0

  if (alterado === 'status') {
    if (proximo.status === 'concluido' && proximo.tipo === 'jogo') proximo.progresso = 100
    if (proximo.status === 'pendente') proximo.progresso = 0
  } else if (alterado === 'progresso' && proximo.tipo === 'jogo') {
    if (proximo.progresso >= 100) proximo.status = 'concluido'
    else if (proximo.progresso > 0 && proximo.status !== 'andamento') proximo.status = 'andamento'
  }
  return proximo
}

// Itens da conta (o servidor já aplica as regras de status/progresso e devolve o modelo normalizado).
export const carregarItens = () => lazerApi.listar()

/* ---------- Capas (cache de URLs temporárias) ---------- */

const urls = new Map() // `${id}:${versao}` -> objectURL

export async function urlDaCapa(item) {
  if (!item.capa) return null
  const chave = `${item.id}:${item.capa.versao}`
  if (urls.has(chave)) return urls.get(chave)

  try {
    const blob = await lazerApi.lerCapaBlob(item.id)
    if (!blob) return null
    const url = URL.createObjectURL(blob)
    // descarta versões antigas desta capa
    for (const [k, v] of urls) {
      if (k.startsWith(`${item.id}:`)) {
        URL.revokeObjectURL(v)
        urls.delete(k)
      }
    }
    urls.set(chave, url)
    return url
  } catch {
    return null
  }
}

export function esquecerCapa(id) {
  for (const [k, v] of urls) {
    if (k.startsWith(`${id}:`)) {
      URL.revokeObjectURL(v)
      urls.delete(k)
    }
  }
}

export const capaHorizontal = (capa) => Boolean(capa) && capa.largura / capa.altura > 1.2
