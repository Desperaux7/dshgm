// Regras da Lista de Desejos que não dependem da tela (validação, ordem, filtros e totais).
// O servidor repete a validação e calcula os totais oficiais a partir do banco; aqui servem para dar
// resposta imediata ao usuário e para atualizar a tela sem esperar a rede.

export const PRIORIDADES = [
  { id: 'alta', nome: 'Alta', ordem: 1 },
  { id: 'media', nome: 'Média', ordem: 2 },
  { id: 'baixa', nome: 'Baixa', ordem: 3 }
]
export const STATUS = [
  { id: 'desejado', nome: 'Desejado' },
  { id: 'comprado', nome: 'Comprado' }
]

export const prioridadeDe = (id) => PRIORIDADES.find((p) => p.id === id) ?? PRIORIDADES[1]

// Só http e https, sem usuário/senha no endereço.
export function urlHttpSegura(texto) {
  try {
    const u = new URL(texto)
    return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password && u.hostname.length > 0
  } catch {
    return false
  }
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
export const formatarBRL = (valor) => brl.format(Number.isFinite(valor) ? valor : 0)

// Aceita "199,90" e "1.299,90" além de "199.90".
export function lerPreco(texto) {
  if (typeof texto === 'number') return texto
  const limpo = String(texto ?? '').trim().replace(/\s/g, '')
  if (limpo === '') return NaN
  const normalizado = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo
  return /^\d+(\.\d+)?$/.test(normalizado) ? Number(normalizado) : NaN
}

// Devolve { dados, erros }. `erros` é um objeto campo -> mensagem; vazio quando está tudo certo.
export function validarProduto(entrada) {
  const erros = {}
  const nome = String(entrada.nome ?? '').trim()
  const descricao = String(entrada.descricao ?? '').trim()
  const linkUrl = String(entrada.linkUrl ?? '').trim()
  const imagemUrl = String(entrada.imagemUrl ?? '').trim()
  const preco = lerPreco(entrada.preco)

  if (!nome) erros.nome = 'Informe o nome do produto.'
  else if (nome.length > 120) erros.nome = 'O nome pode ter no máximo 120 caracteres.'
  if (descricao.length > 500) erros.descricao = 'A descrição pode ter no máximo 500 caracteres.'
  if (linkUrl && (linkUrl.length > 2000 || !urlHttpSegura(linkUrl))) erros.linkUrl = 'Use um link http ou https válido.'
  if (imagemUrl && (imagemUrl.length > 2000 || !urlHttpSegura(imagemUrl))) erros.imagemUrl = 'Use um endereço de imagem http ou https válido.'
  if (!Number.isFinite(preco)) erros.preco = 'Informe o preço médio estimado (use 0 se ainda não sabe).'
  else if (preco < 0) erros.preco = 'O preço não pode ser negativo.'
  else if (preco > 999999999.99) erros.preco = 'Preço alto demais.'
  if (!PRIORIDADES.some((p) => p.id === entrada.prioridade)) erros.prioridade = 'Escolha a prioridade.'
  if (!STATUS.some((s) => s.id === entrada.status)) erros.status = 'Escolha o status.'

  return {
    erros,
    dados: {
      nome,
      descricao,
      linkUrl: linkUrl || null,
      imagemUrl: imagemUrl || null,
      preco: Math.round(preco * 100) / 100,
      prioridade: entrada.prioridade,
      status: entrada.status
    }
  }
}

// Mesma ordem do servidor: prioridade (alta, média, baixa), desejados antes dos comprados, mais novos primeiro.
export function ordenar(itens) {
  return [...itens].sort(
    (a, b) =>
      prioridadeDe(a.prioridade).ordem - prioridadeDe(b.prioridade).ordem ||
      (a.status === 'comprado') - (b.status === 'comprado') ||
      b.criadoEm - a.criadoEm ||
      a.id.localeCompare(b.id)
  )
}

export function filtrar(itens, { prioridade = 'todas', status = 'todos' } = {}) {
  return itens.filter((i) => (prioridade === 'todas' || i.prioridade === prioridade) && (status === 'todos' || i.status === status))
}

// Soma em centavos inteiros (0,1 + 0,2 = 0,30). Usado para a prévia imediata; o valor oficial vem do servidor.
export function calcularTotais(itens) {
  let desejado = 0
  let comprado = 0
  let desejados = 0
  let comprados = 0
  for (const i of itens) {
    const centavos = Math.round(i.preco * 100)
    if (i.status === 'comprado') {
      comprado += centavos
      comprados++
    } else {
      desejado += centavos
      desejados++
    }
  }
  return {
    quantidade: itens.length,
    desejados,
    comprados,
    valorDesejado: desejado / 100,
    valorComprado: comprado / 100,
    valorTotal: (desejado + comprado) / 100
  }
}
