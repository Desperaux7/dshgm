// Imagens enviadas pelo usuário: redimensionamento no navegador e
// armazenamento de capas no IndexedDB (o localStorage não comporta imagens).

const LIMITE_ARQUIVO = 20 * 1024 * 1024

function carregarImagem(arquivo) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(arquivo)
    const imagem = new Image()
    imagem.onload = () => {
      URL.revokeObjectURL(url)
      resolve(imagem)
    }
    imagem.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Não foi possível ler esta imagem.'))
    }
    imagem.src = url
  })
}

/**
 * Redimensiona uma imagem enviada pelo usuário.
 *  - modo 'cobrir': recorta ao centro até preencher exatamente largura × altura
 *  - modo 'conter': só reduz (nunca amplia), mantendo a proporção, dentro de largura × altura
 * Retorna { blob, largura, altura }.
 */
export async function redimensionarImagem(arquivo, { largura, altura, modo = 'conter', qualidade = 0.86 }) {
  if (!arquivo || !arquivo.type.startsWith('image/')) {
    throw new Error('Escolha um arquivo de imagem (JPG, PNG, WebP...).')
  }
  if (arquivo.size > LIMITE_ARQUIVO) {
    throw new Error('A imagem é grande demais (máximo de 20 MB).')
  }

  const imagem = await carregarImagem(arquivo)
  const origemL = imagem.naturalWidth
  const origemA = imagem.naturalHeight
  if (!origemL || !origemA) throw new Error('Não foi possível ler esta imagem.')

  let destinoL
  let destinoA
  let corte = { x: 0, y: 0, l: origemL, a: origemA }

  if (modo === 'cobrir') {
    destinoL = largura
    destinoA = altura
    const escala = Math.max(largura / origemL, altura / origemA)
    corte.l = largura / escala
    corte.a = altura / escala
    corte.x = (origemL - corte.l) / 2
    corte.y = (origemA - corte.a) / 2
  } else {
    const escala = Math.min(1, largura / origemL, altura / origemA)
    destinoL = Math.max(1, Math.round(origemL * escala))
    destinoA = Math.max(1, Math.round(origemA * escala))
  }

  const tela = document.createElement('canvas')
  tela.width = destinoL
  tela.height = destinoA
  const contexto = tela.getContext('2d')
  contexto.imageSmoothingQuality = 'high'
  contexto.drawImage(imagem, corte.x, corte.y, corte.l, corte.a, 0, 0, destinoL, destinoA)

  const blob = await new Promise((resolve) => tela.toBlob(resolve, 'image/jpeg', qualidade))
  if (!blob) throw new Error('Não foi possível processar esta imagem.')

  return { blob, largura: destinoL, altura: destinoA }
}

export function blobParaDataURL(blob) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader()
    leitor.onload = () => resolve(leitor.result)
    leitor.onerror = () => reject(new Error('Não foi possível ler a imagem.'))
    leitor.readAsDataURL(blob)
  })
}

/* ---------- IndexedDB: capas da central de lazer ---------- */

const BANCO = 'dashboard-imagens'
const LOJA = 'capas'

function abrirBanco() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('Este navegador não permite salvar imagens localmente.'))
      return
    }
    const pedido = indexedDB.open(BANCO, 1)
    pedido.onupgradeneeded = () => pedido.result.createObjectStore(LOJA)
    pedido.onsuccess = () => resolve(pedido.result)
    pedido.onerror = () => reject(pedido.error ?? new Error('Falha ao abrir o armazenamento de imagens.'))
  })
}

async function transacao(modo, operacao) {
  const banco = await abrirBanco()
  return new Promise((resolve, reject) => {
    const tx = banco.transaction(LOJA, modo)
    const pedido = operacao(tx.objectStore(LOJA))
    tx.oncomplete = () => {
      banco.close()
      resolve(pedido?.result ?? null)
    }
    tx.onerror = tx.onabort = () => {
      banco.close()
      reject(tx.error ?? new Error('Falha ao acessar o armazenamento de imagens.'))
    }
  })
}

export const salvarCapa = (id, blob) => transacao('readwrite', (loja) => loja.put(blob, id))
export const lerCapa = (id) => transacao('readonly', (loja) => loja.get(id))
export const excluirCapa = (id) => transacao('readwrite', (loja) => loja.delete(id))
