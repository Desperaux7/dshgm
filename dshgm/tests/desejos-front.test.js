import { describe, expect, it } from 'vitest'
import { calcularTotais, filtrar, lerPreco, ordenar, urlHttpSegura, validarProduto } from '../src/modules/desejos.js'

const base = { nome: 'Fone', descricao: '', linkUrl: '', imagemUrl: '', preco: '199,90', prioridade: 'media', status: 'desejado' }

describe('lista de desejos (regras da tela)', () => {
  it('valida nome, preço e links, e normaliza os dados', () => {
    expect(validarProduto(base).erros).toEqual({})
    expect(validarProduto(base).dados).toMatchObject({ nome: 'Fone', preco: 199.9, linkUrl: null, imagemUrl: null })
    expect(Object.keys(validarProduto({ ...base, nome: '  ', preco: '' }).erros).sort()).toEqual(['nome', 'preco'])
    expect(validarProduto({ ...base, preco: '0' }).erros).toEqual({})
    expect(validarProduto({ ...base, preco: '-5' }).erros.preco).toBeTruthy()
    expect(validarProduto({ ...base, linkUrl: 'javascript:alert(1)' }).erros.linkUrl).toBeTruthy()
    expect(validarProduto({ ...base, imagemUrl: 'ftp://x.com/a.png' }).erros.imagemUrl).toBeTruthy()
    expect(validarProduto({ ...base, linkUrl: 'https://loja.com/p?id=1' }).erros).toEqual({})
  })

  it('só aceita http e https, sem credenciais no endereço', () => {
    expect(urlHttpSegura('https://a.com/x')).toBe(true)
    expect(urlHttpSegura('http://a.com')).toBe(true)
    for (const u of ['javascript:alert(1)', 'data:text/html,x', 'file:///x', 'https://u:p@a.com', 'a.com', '']) expect(urlHttpSegura(u)).toBe(false)
  })

  it('lê preços no formato brasileiro e em ponto decimal', () => {
    expect(lerPreco('199,90')).toBe(199.9)
    expect(lerPreco('1.299,90')).toBe(1299.9)
    expect(lerPreco('1299.90')).toBe(1299.9)
    expect(lerPreco(10)).toBe(10)
    expect(Number.isNaN(lerPreco('abc'))).toBe(true)
    expect(Number.isNaN(lerPreco(''))).toBe(true)
  })

  it('ordena por prioridade e filtra por prioridade e status', () => {
    const itens = [
      { id: 'a', nome: 'A', prioridade: 'baixa', status: 'desejado', criadoEm: 3, preco: 1 },
      { id: 'b', nome: 'B', prioridade: 'alta', status: 'comprado', criadoEm: 2, preco: 1 },
      { id: 'c', nome: 'C', prioridade: 'alta', status: 'desejado', criadoEm: 1, preco: 1 },
      { id: 'd', nome: 'D', prioridade: 'media', status: 'desejado', criadoEm: 4, preco: 1 }
    ]
    expect(ordenar(itens).map((i) => i.nome)).toEqual(['C', 'B', 'D', 'A'])
    expect(filtrar(itens, { prioridade: 'alta' }).map((i) => i.nome)).toEqual(['b', 'c'].map((x) => x.toUpperCase()))
    expect(filtrar(itens, { status: 'comprado' }).map((i) => i.nome)).toEqual(['B'])
    expect(filtrar(itens, { prioridade: 'alta', status: 'desejado' }).map((i) => i.nome)).toEqual(['C'])
    expect(filtrar(itens)).toHaveLength(4)
  })

  it('totais somam em centavos exatos', () => {
    const itens = [
      { id: '1', preco: 0.1, status: 'desejado' },
      { id: '2', preco: 0.2, status: 'desejado' },
      { id: '3', preco: 99.99, status: 'comprado' }
    ]
    expect(calcularTotais(itens)).toEqual({ quantidade: 3, desejados: 2, comprados: 1, valorDesejado: 0.3, valorComprado: 99.99, valorTotal: 100.29 })
    expect(calcularTotais([]).valorTotal).toBe(0)
  })
})
