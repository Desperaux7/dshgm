import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { CARTOES, LINKS, cartaoVisivel, cartoesDoModo, linksDoModo, padraoCartoes } from '../src/modules/modos.js'
import { paginar } from '../src/services/paginacao.js'
import { statusPelaChecklist, resumoChecklist } from '../src/services/tarefasApi.js'
import { agruparPorSubtime, melhoriasEmAberto, resumoDosTimes, ultimoEvento } from '../src/services/timesApi.js'
import { itensDaBarra } from '../src/modules/favoritos.js'
import { statusPelaChecklist as statusServidor } from '../server/lib/checklist.js'

const ler = (p) => readFile(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8')

describe('modos de uso: menu lateral', () => {
  const ids = (modo) => linksDoModo(modo).map((l) => l.id)

  it('o ícone "Gráficos" foi removido do menu', () => {
    expect(LINKS.some((l) => l.id === 'graficos' || l.icone === 'chart')).toBe(false)
  })

  it('pessoal: início, tarefas, agenda, favoritos, lazer, desejos, finanças e Spotify', () => {
    expect(ids('pessoal')).toEqual(['inicio', 'tarefas', 'agenda', 'favoritos', 'lazer', 'desejos', 'financeiro', 'spotify'])
  })

  it('profissional: só agenda, tarefas, finanças e Times (mais o início)', () => {
    expect(ids('profissional')).toEqual(['inicio', 'tarefas', 'agenda', 'times', 'financeiro'])
  })

  it('todo link do menu aponta para um arquivo que existe no build', async () => {
    const vite = await ler('vite.config.js')
    for (const l of LINKS) expect(vite, l.href).toContain(l.href.split('#')[0])
  })
})

describe('modos de uso: cartões da página inicial', () => {
  const base = { modo: 'pessoal', cartoes: {}, cartoesPro: {} }

  it('no pessoal não há cartões de Times; no profissional não há Spotify nem atalhos', () => {
    expect(cartaoVisivel('painel-times', base)).toBe(false)
    expect(cartaoVisivel('resumo-times', base)).toBe(false)
    expect(cartaoVisivel('painel-spotify', base)).toBe(true)
    const pro = { ...base, modo: 'profissional' }
    expect(cartaoVisivel('painel-times', pro)).toBe(true)
    expect(cartaoVisivel('painel-spotify', pro)).toBe(false)
    expect(cartaoVisivel('atalhos', pro)).toBe(false)
  })

  it('a visão geral profissional reflete os 4 módulos: agenda, tarefas, finanças e times', () => {
    const ids = cartoesDoModo('profissional').map((c) => c.id)
    for (const id of ['resumo-agenda', 'painel-agenda', 'resumo-tarefas', 'painel-tarefas', 'resumo-saldo', 'resumo-times', 'painel-times']) expect(ids).toContain(id)
    expect(ids).not.toContain('painel-spotify')
  })

  it('cada modo guarda a própria escolha (desligar no pessoal não desliga no profissional)', () => {
    const prefs = { modo: 'pessoal', cartoes: { 'painel-agenda': false }, cartoesPro: {} }
    expect(cartaoVisivel('painel-agenda', prefs)).toBe(false)
    expect(cartaoVisivel('painel-agenda', { ...prefs, modo: 'profissional' })).toBe(true)
    const pro = { modo: 'profissional', cartoes: {}, cartoesPro: { 'painel-times': false } }
    expect(cartaoVisivel('painel-times', pro)).toBe(false)
  })

  it('contas antigas (sem modo ou com modo inválido) funcionam como pessoal', () => {
    expect(cartaoVisivel('painel-spotify', { cartoes: {} })).toBe(true)
    expect(cartaoVisivel('painel-times', { modo: 'qualquer', cartoes: {} })).toBe(false)
  })

  it('elementos que não estão no catálogo nunca são escondidos', () => {
    expect(cartaoVisivel('algo-novo', base)).toBe(true)
  })

  it('o padrão liga todos os cartões do modo', () => {
    expect(Object.values(padraoCartoes('pessoal')).every(Boolean)).toBe(true)
    expect(Object.keys(padraoCartoes('profissional'))).toHaveLength(cartoesDoModo('profissional').length)
    expect(CARTOES.length).toBeGreaterThan(0)
  })
})

describe('paginação do histórico (10 por página)', () => {
  it('menos de 10 itens: uma página; 25 itens: 3 páginas com 10, 10 e 5', () => {
    expect(paginar(0, 1)).toEqual({ paginas: 1, atual: 1, inicio: 0, fim: 0 })
    expect(paginar(7, 1)).toEqual({ paginas: 1, atual: 1, inicio: 0, fim: 7 })
    expect(paginar(25, 1)).toEqual({ paginas: 3, atual: 1, inicio: 0, fim: 10 })
    expect(paginar(25, 2)).toEqual({ paginas: 3, atual: 2, inicio: 10, fim: 20 })
    expect(paginar(25, 3)).toEqual({ paginas: 3, atual: 3, inicio: 20, fim: 25 })
  })

  it('exatamente 10 itens cabem em uma página só', () => {
    expect(paginar(10, 1).paginas).toBe(1)
    expect(paginar(11, 1).paginas).toBe(2)
  })

  it('a página é corrigida quando o total encolhe (ex.: excluiu o último da última página)', () => {
    expect(paginar(20, 3).atual).toBe(2)
    expect(paginar(0, 5).atual).toBe(1)
    expect(paginar(25, 0).atual).toBe(1)
    expect(paginar(25, 'x').atual).toBe(1)
  })
})

describe('checklist: regra no navegador igual à do servidor', () => {
  it('todos os cenários dão o mesmo resultado', () => {
    for (const atual of ['pendente', 'andamento', 'concluida']) {
      for (const [total, feitos] of [[0, 0], [3, 0], [3, 1], [3, 3]]) {
        for (const desmarcou of [false, true]) {
          expect(statusPelaChecklist(atual, total, feitos, { desmarcou }), `${atual} ${total}/${feitos} ${desmarcou}`).toBe(
            statusServidor(atual, total, feitos, { desmarcou })
          )
        }
      }
    }
  })

  it('conta os itens marcados no dia', () => {
    const t = { checklist: [{ feitos: { '2026-11-14': true } }, { feitos: {} }, { feitos: { '2026-11-15': true } }] }
    expect(resumoChecklist(t, '2026-11-14')).toEqual({ total: 3, feitos: 1 })
    expect(resumoChecklist({}, '2026-11-14')).toEqual({ total: 0, feitos: 0 })
  })
})

describe('favoritos: barras e pastas', () => {
  const pastas = [{ id: 'p1', nome: 'Trabalho', barra: 'superior', criado: 5 }, { id: 'p2', nome: 'Estudo', barra: 'central', criado: 2 }]
  const favs = [
    { id: 'a', nome: 'A', url: 'https://a.com', fixado: true, pastaId: null, barra: 'central', criado: 1 },
    { id: 'b', nome: 'B', url: 'https://b.com', fixado: true, pastaId: null, barra: 'superior', criado: 3 },
    { id: 'c', nome: 'C', url: 'https://c.com', fixado: false, pastaId: null, barra: 'central', criado: 4 },
    { id: 'd', nome: 'D', url: 'https://d.com', fixado: false, pastaId: 'p1', barra: 'superior', criado: 6 },
    { id: 'e', nome: 'E', url: 'https://e.com', fixado: true, pastaId: 'p1', barra: 'superior', criado: 7 }
  ]

  it('cada barra mostra só o que é dela, na ordem de criação', () => {
    expect(itensDaBarra(favs, pastas, 'central').map((i) => i.pasta?.id ?? i.link.id)).toEqual(['a', 'p2'])
    expect(itensDaBarra(favs, pastas, 'superior').map((i) => i.pasta?.id ?? i.link.id)).toEqual(['b', 'p1'])
  })

  it('link solto desligado ("fixado" falso) não aparece; link dentro de pasta aparece com a pasta, fixado ou não', () => {
    expect(itensDaBarra(favs, pastas, 'central').some((i) => i.link?.id === 'c')).toBe(false)
    const pasta = itensDaBarra(favs, pastas, 'superior').find((i) => i.pasta?.id === 'p1')
    expect(pasta.links.map((l) => l.id)).toEqual(['d', 'e'])
  })

  it('pasta vazia continua aparecendo (para receber links)', () => {
    expect(itensDaBarra([], pastas, 'central')).toHaveLength(1)
  })
})

describe('times: agrupamento e resumos', () => {
  const time = {
    id: 't',
    subtimes: [{ id: 's1', nome: 'Cobrança' }, { id: 's2', nome: 'SAC' }],
    colaboradores: [
      { id: '1', subtimeId: null, pontosMelhoria: [], eventos: [] },
      { id: '2', subtimeId: 's1', pontosMelhoria: [{ desenvolvido: false }, { desenvolvido: true }], eventos: [{ data: '2026-11-01', texto: 'a' }, { data: '2026-11-10', texto: 'b' }] }
    ]
  }

  it('sem subtime primeiro, depois cada subtime (mesmo vazio)', () => {
    const g = agruparPorSubtime(time)
    expect(g.map((x) => x.subtime?.nome ?? null)).toEqual([null, 'Cobrança', 'SAC'])
    expect(g.map((x) => x.colaboradores.length)).toEqual([1, 1, 0])
  })

  it('pontos de melhoria em aberto e último evento', () => {
    expect(melhoriasEmAberto(time.colaboradores[1])).toHaveLength(1)
    expect(ultimoEvento(time.colaboradores[1]).texto).toBe('b')
    expect(ultimoEvento(time.colaboradores[0])).toBeNull()
  })

  it('resumo para a página inicial', () => {
    expect(resumoDosTimes([time])).toEqual({ times: 1, colaboradores: 2, melhoriasEmAberto: 1 })
    expect(resumoDosTimes([])).toEqual({ times: 0, colaboradores: 0, melhoriasEmAberto: 0 })
  })
})

describe('estrutura das páginas e estilos', () => {
  it('a pesquisa do Google ainda abre em nova guia e agora recolhe depois de pesquisar', async () => {
    const html = await ler('index.html')
    expect(html).toMatch(/<form[^>]*google\.com\/search[^>]*>/)
    const js = await ler('src/modules/google-search.js')
    expect(js).toMatch(/setTimeout\(\(\) => definirAberta\(false\), 0\)/)
  })

  it('a página Times existe e está no build', async () => {
    const vite = await ler('vite.config.js')
    expect(vite).toContain('times.html')
    const html = await ler('times.html')
    for (const id of ['team-tabs', 'team-view', 'team-dialog', 'sub-dialog', 'member-dialog', 'member-improvements']) expect(html).toContain(`id="${id}"`)
  })

  it('a página inicial tem os cartões de Times (escondidos no modo pessoal pelos dados do cartão)', async () => {
    const html = await ler('index.html')
    expect(html).toContain('data-card="resumo-times"')
    expect(html).toContain('data-card="painel-times"')
    expect(html).toContain('id="task-checklist-edit"')
  })

  it('as 4 novas cores existem no CSS, no painel de perfil e na validação do servidor', async () => {
    const css = await ler('src/styles/main.css')
    const perfil = await ler('server/routes/perfil.js')
    const prefs = await ler('src/modules/preferencias.js')
    for (const cor of ['vermelho', 'dourado', 'monocromo', 'sakura']) {
      expect(css, cor).toContain(`:root[data-accent='${cor}']`)
      expect(perfil, cor).toContain(`'${cor}'`)
      expect(prefs, cor).toContain(`id: '${cor}'`)
    }
    // as cores que já existiam continuam
    for (const cor of ['oceano', 'menta', 'ambar']) expect(css, cor).toContain(`:root[data-accent='${cor}']`)
  })

  it('o botão "Todos" saiu da barra central e fica no canto superior, ao lado do avatar', async () => {
    const fav = await ler('src/modules/favoritos.js')
    expect(fav).not.toContain("'Todos'")
    const shell = await ler('src/modules/shell.js')
    expect(shell.indexOf('id="top-favs"')).toBeLessThan(shell.indexOf('id="avatar-btn"'))
    expect(shell).toContain('top-all')
  })

  it('toda página aplica o modo antes da primeira pintura', async () => {
    for (const p of ['index.html', 'financeiro.html', 'favoritos.html', 'agenda.html', 'lazer.html', 'desejos.html', 'times.html']) {
      expect(await ler(p), p).toContain('r.dataset.modo = p.modo')
    }
  })
})
