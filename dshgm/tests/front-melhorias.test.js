import { describe, expect, it } from 'vitest'
import { dominioPrincipal } from '../src/modules/favoritos.js'
import { statusDoDia } from '../src/services/tarefasApi.js'
import { aplicarRegras, capaPrecisaConter, modeloDe } from '../src/modules/lazer.js'

describe('ícones dos sites', () => {
  it('sugere o domínio principal sem quebrar sufixos como .com.br', () => {
    expect(dominioPrincipal('mail.google.com')).toBe('google.com')
    expect(dominioPrincipal('app.empresa.com.br')).toBe('empresa.com.br')
    expect(dominioPrincipal('empresa.com.br')).toBeNull()
    expect(dominioPrincipal('github.com')).toBeNull()
    expect(dominioPrincipal('localhost')).toBeNull()
  })
})

describe('status da tarefa na tela', () => {
  it('concluída vence andamento, que vence pendente', () => {
    const t = { concluidas: { '2026-10-22': true }, andamento: { '2026-10-22': true, '2026-10-23': true } }
    expect(statusDoDia(t, '2026-10-22')).toBe('concluida')
    expect(statusDoDia(t, '2026-10-23')).toBe('andamento')
    expect(statusDoDia(t, '2026-10-24')).toBe('pendente')
    expect(statusDoDia({}, '2026-10-24')).toBe('pendente')
  })
})

describe('lazer: modelos e capas', () => {
  it('jogo, filme e série têm modelos de cartão próprios', () => {
    expect(modeloDe('jogo')).toBe('jogo')
    expect(modeloDe('filme')).toBe('midia')
    expect(modeloDe('serie')).toBe('midia')
  })

  it('capa de formato diferente do quadro aparece inteira, a do mesmo formato preenche', () => {
    const horizontal = { largura: 920, altura: 430 }
    const vertical = { largura: 600, altura: 900 }
    // Todos os tipos usam o quadro vertical 2:3 (Steam Grid 600×900 para jogos).
    for (const modelo of ['jogo', 'midia']) {
      expect(capaPrecisaConter(vertical, modelo)).toBe(false)
      expect(capaPrecisaConter(horizontal, modelo)).toBe(true)
      expect(capaPrecisaConter(null, modelo)).toBe(false)
    }
  })

  it('o progresso em porcentagem não é mais usado', () => {
    expect(aplicarRegras({ tipo: 'jogo', status: 'andamento', progresso: 60 }).progresso).toBe(0)
  })
})
