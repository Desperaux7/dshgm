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
    progresso: 0..100,                 // legado: não é mais exibido nem editado (ver aplicarRegras)
    capa: { largura, altura, versao } | null,   // a imagem fica na conta (GET /api/lazer/:id/capa)
    criado, atualizado
  }
*/

// O progresso em porcentagem foi removido da tela (exigiria atualização manual e não refletia o jogo de verdade).
// A coluna continua na conta por compatibilidade, mas a tela não a exibe nem a envia: o status é a única informação.
export function aplicarRegras(item) {
  return { ...item, progresso: 0 }
}

// Itens da conta (o servidor devolve o modelo normalizado).
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

/*
  Dois modelos de cartão (o selo de concluído muda: jogo = "Zerado", filme/série = "Assistido").
  A capa de todos os tipos segue o padrão vertical 2:3 (jogos: Steam Grid 600×900; filmes/séries: pôster).
*/
export const modeloDe = (tipo) => (tipo === 'jogo' ? 'jogo' : 'midia')

// O quadro é vertical (2:3): capa vertical preenche; capa horizontal aparece inteira sobre um fundo desfocado.
// (`modelo` fica na assinatura para o caso de um tipo voltar a ter formato próprio.)
export function capaPrecisaConter(capa) {
  return capaHorizontal(capa)
}
