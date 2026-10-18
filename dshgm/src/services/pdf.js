// Gerador de PDF mínimo, sem dependências: texto, linhas e retângulos em A4,
// com as fontes padrão Helvetica / Helvetica-Bold (acentos do português incluídos).
// Coordenadas em pontos (1/72"), com a origem no canto superior esquerdo.

// Larguras (1/1000 em) dos caracteres ASCII 32..126.
const LARGURAS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584
]

const LARGURAS_NEGRITO = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584
]

// Caracteres fora do ASCII que existem na codificação WinAnsi (cp1252).
const ESPECIAIS = {
  '€': 0x80, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97
}

// Converte um caractere para o byte WinAnsi (ou "?" se não existir).
function codigo(c) {
  const n = c.charCodeAt(0)
  if (n >= 32 && n <= 126) return n
  if (n === 0xa0) return 0x20
  if (n >= 0xa1 && n <= 0xff) return n
  if (c === '−') return 0x2d
  return ESPECIAIS[c] ?? 0x3f
}

function larguraCaractere(c, negrito) {
  const n = c.charCodeAt(0)
  const tabela = negrito ? LARGURAS_NEGRITO : LARGURAS
  if (n >= 32 && n <= 126) return tabela[n - 32]
  if (n === 0xa0) return 278
  // Letras acentuadas têm a mesma largura da letra base.
  const base = c.normalize('NFD')[0]
  const b = base.charCodeAt(0)
  if (b >= 32 && b <= 126 && base !== c) return tabela[b - 32]
  if (c === '–') return 556
  if (c === '—') return 1000
  if (c === '•') return 350
  if (c === '…') return 1000
  if (c === '°' || c === 'º' || c === 'ª') return 400
  if (c === '·') return 278
  return 556
}

const escapar = (texto) =>
  [...texto]
    .map((c) => {
      const n = codigo(c)
      if (c === '\\' || c === '(' || c === ')') return `\\${c}`
      return n < 127 ? c : `\\${n.toString(8).padStart(3, '0')}`
    })
    .join('')

const num = (n) => (Math.round(n * 100) / 100).toString()

function cor([r, g, b]) {
  return `${num(r / 255)} ${num(g / 255)} ${num(b / 255)}`
}

export const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))

export class DocumentoPDF {
  constructor({ largura = 595.28, altura = 841.89, titulo = 'Documento' } = {}) {
    this.largura = largura
    this.altura = altura
    this.titulo = titulo
    this.paginas = []
  }

  get total() {
    return this.paginas.length
  }

  novaPagina() {
    this.paginas.push([])
    return this.paginas.length
  }

  // Seleciona uma página já criada (para desenhar rodapés com "Página X de Y").
  irParaPagina(numero) {
    this.atual = this.paginas[numero - 1]
  }

  get ops() {
    return this.atual ?? this.paginas[this.paginas.length - 1]
  }

  medir(texto, { tam = 10, negrito = false } = {}) {
    let total = 0
    for (const c of texto) total += larguraCaractere(c, negrito)
    return (total * tam) / 1000
  }

  truncar(texto, larguraMax, opcoes = {}) {
    if (this.medir(texto, opcoes) <= larguraMax) return texto
    let cortado = texto
    while (cortado.length > 1 && this.medir(`${cortado}...`, opcoes) > larguraMax) cortado = cortado.slice(0, -1)
    return `${cortado.trimEnd()}...`
  }

  // y é a linha de base do texto, medida a partir do topo.
  texto(texto, x, y, { tam = 10, negrito = false, cor: c = [0, 0, 0], alinhar = 'esquerda' } = {}) {
    if (!texto) return
    const w = this.medir(texto, { tam, negrito })
    const px = alinhar === 'direita' ? x - w : alinhar === 'centro' ? x - w / 2 : x
    this.ops.push(
      `BT /${negrito ? 'F2' : 'F1'} ${num(tam)} Tf ${cor(c)} rg ${num(px)} ${num(this.altura - y)} Td (${escapar(texto)}) Tj ET`
    )
  }

  linha(x1, y1, x2, y2, { cor: c = [0, 0, 0], espessura = 0.5 } = {}) {
    this.ops.push(
      `${cor(c)} RG ${num(espessura)} w ${num(x1)} ${num(this.altura - y1)} m ${num(x2)} ${num(this.altura - y2)} l S`
    )
  }

  retangulo(x, y, w, h, { preenchimento = null, borda = null, espessura = 0.5 } = {}) {
    const partes = []
    if (preenchimento) partes.push(`${cor(preenchimento)} rg`)
    if (borda) partes.push(`${cor(borda)} RG ${num(espessura)} w`)
    partes.push(`${num(x)} ${num(this.altura - y - h)} ${num(w)} ${num(h)} re`)
    partes.push(preenchimento && borda ? 'B' : preenchimento ? 'f' : 'S')
    this.ops.push(partes.join(' '))
  }

  gerar() {
    const objetos = []
    const add = (conteudo) => objetos.push(conteudo) && objetos.length // retorna o número do objeto

    add('<< /Type /Catalog /Pages 2 0 R >>') // 1
    add('') // 2: preenchido depois
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>') // 3
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>') // 4

    const filhos = []
    for (const ops of this.paginas) {
      const fluxo = ops.join('\n')
      const conteudo = add(`<< /Length ${fluxo.length} >>\nstream\n${fluxo}\nendstream`)
      const pagina = add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(this.largura)} ${num(this.altura)}] ` +
          `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${conteudo} 0 R >>`
      )
      filhos.push(`${pagina} 0 R`)
    }
    objetos[1] = `<< /Type /Pages /Kids [${filhos.join(' ')}] /Count ${filhos.length} >>`
    const info = add(`<< /Title (${escapar(this.titulo)}) /Producer (Dashboard Pessoal) >>`)

    let saida = '%PDF-1.4\n'
    const posicoes = []
    objetos.forEach((conteudo, i) => {
      posicoes.push(saida.length)
      saida += `${i + 1} 0 obj\n${conteudo}\nendobj\n`
    })

    const xref = saida.length
    saida += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`
    posicoes.forEach((p) => (saida += `${String(p).padStart(10, '0')} 00000 n \n`))
    saida += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF`

    // Todo o conteúdo é ASCII (acentos saem como escapes octais), então 1 char = 1 byte.
    const bytes = new Uint8Array(saida.length)
    for (let i = 0; i < saida.length; i++) bytes[i] = saida.charCodeAt(i) & 0xff
    return bytes
  }

  blob() {
    return new Blob([this.gerar()], { type: 'application/pdf' })
  }
}
