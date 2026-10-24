import { describe, expect, it } from 'vitest'
import { SECOES, jaMigrada, lerPendencias, migrar, tarefasLegado } from '../src/services/migracao.js'
import { CHAVE_DONO, definirDonoDoCache, donoDoCache, limparCache } from '../src/services/cacheLocal.js'

// localStorage falso (o ambiente de teste é Node)
function armazenamentoFalso(inicial = {}) {
  const m = new Map(Object.entries(inicial))
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    chaves: () => [...m.keys()]
  }
}

const SECAO_LISTA = {
  id: 'tarefas',
  chave: 'dashboard-tarefas',
  rotulo: 'Tarefas',
  tipo: 'lista',
  manterLocal: false,
  chaveResultado: 'tarefas',
  corpo: (dados) => ({ tarefas: dados })
}
const agora = () => new Date('2026-10-20T12:00:00Z')

describe('migração dos dados do navegador', () => {
  it('detecta só o que existe, é válido e ainda não foi migrado', () => {
    const arm = armazenamentoFalso({
      'dashboard-preferencias': JSON.stringify({ nome: 'Gustavo' }),
      'dashboard-tarefas': '[]', // vazio: nada a importar
      'dashboard-agenda': '{corrompido' // inválido: preservado, não importado
    })
    const secoes = [...SECOES, SECAO_LISTA, { ...SECAO_LISTA, id: 'agenda', chave: 'dashboard-agenda' }]
    const p = lerPendencias({ armazenamento: arm, userId: 'u1', secoes })
    expect(p.map((x) => x.secao.id)).toEqual(['preferencias'])
    expect(arm.getItem('dashboard-agenda')).toBe('{corrompido')
  })

  it('preferências: importa, mantém o cache local e registra a migração', async () => {
    const arm = armazenamentoFalso({ 'dashboard-preferencias': JSON.stringify({ nome: 'Gustavo', destaque: 'menta' }) })
    const chamadas = []
    const api = { post: async (rota, corpo) => { chamadas.push([rota, corpo]); return { resultado: { preferencias: { estado: 'importadas' } } } } }
    const { relatorio } = await migrar({ api, armazenamento: arm, userId: 'u1', agora })
    expect(chamadas).toEqual([['/importacao', { preferencias: { nome: 'Gustavo', destaque: 'menta' } }]])
    expect(relatorio[0]).toMatchObject({ id: 'preferencias', status: 'ok', detalhe: 'importadas' })
    expect(arm.getItem('dashboard-preferencias')).not.toBeNull() // continua como cache
    expect(jaMigrada(arm, 'u1', 'preferencias')).toBe(true)
    // segunda execução: nada a fazer, nenhuma chamada
    await migrar({ api: { post: () => { throw new Error('não deveria chamar') } }, armazenamento: arm, userId: 'u1', agora })
  })

  it('lista: só apaga o dado local depois que todos os registros foram confirmados', async () => {
    const arm = armazenamentoFalso({ 'dashboard-tarefas': JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }]) })
    const api = { post: async () => ({ resultado: { tarefas: { recebidos: 3, importados: 2, jaExistiam: 1, rejeitados: [] } } }) }
    const { relatorio } = await migrar({ api, armazenamento: arm, userId: 'u1', secoes: [SECAO_LISTA], agora })
    expect(relatorio[0]).toMatchObject({ status: 'ok', importados: 2, jaExistiam: 1 })
    expect(arm.getItem('dashboard-tarefas')).toBeNull()
  })

  it('registros rejeitados: o original vai para cópia de segurança e nada é perdido', async () => {
    const original = JSON.stringify([{ id: 1 }, { id: 2 }])
    const arm = armazenamentoFalso({ 'dashboard-tarefas': original })
    const api = { post: async () => ({ resultado: { tarefas: { recebidos: 2, importados: 1, jaExistiam: 0, rejeitados: [{ indice: 1, motivo: 'texto vazio' }] } } }) }
    const { relatorio } = await migrar({ api, armazenamento: arm, userId: 'u1', secoes: [SECAO_LISTA], agora })
    expect(relatorio[0].status).toBe('parcial')
    expect(relatorio[0].backup).toBe('dashboard-tarefas-backup-2026-10-20')
    expect(arm.getItem('dashboard-tarefas-backup-2026-10-20')).toBe(original)
  })

  it('totais que não fecham: nada é apagado e a migração não é marcada como feita', async () => {
    const arm = armazenamentoFalso({ 'dashboard-tarefas': JSON.stringify([{ id: 1 }, { id: 2 }]) })
    const api = { post: async () => ({ resultado: { tarefas: { recebidos: 2, importados: 1, jaExistiam: 0, rejeitados: [] } } }) }
    const { relatorio } = await migrar({ api, armazenamento: arm, userId: 'u1', secoes: [SECAO_LISTA], agora })
    expect(relatorio[0].status).toBe('erro')
    expect(arm.getItem('dashboard-tarefas')).not.toBeNull()
    expect(jaMigrada(arm, 'u1', 'tarefas')).toBe(false)
  })

  it('falha de rede: propaga o erro e preserva tudo', async () => {
    const arm = armazenamentoFalso({ 'dashboard-tarefas': JSON.stringify([{ id: 1 }]) })
    const api = { post: async () => { throw new Error('sem conexão') } }
    await expect(migrar({ api, armazenamento: arm, userId: 'u1', secoes: [SECAO_LISTA], agora })).rejects.toThrow('sem conexão')
    expect(arm.getItem('dashboard-tarefas')).not.toBeNull()
  })

  it('preferências rejeitadas pelo servidor: relata erro sem marcar como migrada', async () => {
    const arm = armazenamentoFalso({ 'dashboard-preferencias': JSON.stringify({ destaque: 'neon' }) })
    const api = { post: async () => ({ resultado: { preferencias: { estado: 'rejeitadas' } } }) }
    const { relatorio } = await migrar({ api, armazenamento: arm, userId: 'u1', agora })
    expect(relatorio[0].status).toBe('erro')
    expect(jaMigrada(arm, 'u1', 'preferencias')).toBe(false)
  })

  it('a marca de migração é por usuário (outra conta não herda)', async () => {
    const arm = armazenamentoFalso({ 'dashboard-preferencias': JSON.stringify({ nome: 'A' }) })
    const api = { post: async () => ({ resultado: { preferencias: { estado: 'importadas' } } }) }
    await migrar({ api, armazenamento: arm, userId: 'conta-a', agora })
    expect(jaMigrada(arm, 'conta-a', 'preferencias')).toBe(true)
    expect(jaMigrada(arm, 'conta-b', 'preferencias')).toBe(false)
  })
})

describe('tarefas do navegador', () => {
  const hoje = new Date(2026, 9, 20, 12)
  it('converte o formato mais antigo e preserva o formato novo', () => {
    const r = tarefasLegado([
      { id: 1, texto: 'Antiga', concluida: true },
      { id: 2, texto: 'Nova', tipo: 'recorrente', dias: [1], criada: '2026-09-01', concluidas: { '2026-10-19': true } },
      { id: 3, texto: 'Pendente antiga' }
    ], hoje)
    expect(r[0]).toMatchObject({ concluidas: { '2026-10-20': true }, data: '2026-10-20', criada: '2026-10-20' })
    expect(r[1]).toMatchObject({ criada: '2026-09-01', concluidas: { '2026-10-19': true }, dias: [1] })
    expect(r[2].concluidas).toEqual({})
  })
  it('itens inválidos passam intactos (o servidor os rejeita e o original é guardado)', () => {
    const lixo = [null, 42, { id: 9 }, 'texto']
    expect(tarefasLegado(lixo, hoje)).toEqual(lixo)
    expect(tarefasLegado('nao-lista', hoje)).toEqual([])
  })
  it('entra na lista de seções migráveis, sem manter cópia local', () => {
    const s = SECOES.find((x) => x.id === 'tarefas')
    expect(s).toMatchObject({ chave: 'dashboard-tarefas', manterLocal: false, chaveResultado: 'tarefas' })
  })
})

describe('financeiro do navegador', () => {
  it('movimentações entram como lista e a meta como estado, ambas sem cópia local depois de confirmadas', () => {
    expect(SECOES.find((x) => x.id === 'financeiro')).toMatchObject({ chave: 'dashboard-financeiro', chaveResultado: 'transacoes', manterLocal: false })
    expect(SECOES.find((x) => x.id === 'meta')).toMatchObject({ chave: 'dashboard-metas', chaveResultado: 'meta', manterLocal: false })
  })

  it('importa movimentações e meta no mesmo envio e limpa o local só após confirmar', async () => {
    const arm = armazenamentoFalso({
      'dashboard-financeiro': JSON.stringify([{ id: 'a' }, { id: 'b' }]),
      'dashboard-metas': JSON.stringify({ nome: 'Viagem', valor: 1000, prazo: '2027-01' })
    })
    let corpo
    const api = { post: async (_r, c) => { corpo = c; return { resultado: { transacoes: { recebidos: 2, importados: 2, jaExistiam: 0, rejeitados: [] }, meta: { estado: 'importada' } } } } }
    const { relatorio } = await migrar({ api, armazenamento: arm, userId: 'u1', agora })
    expect(Object.keys(corpo).sort()).toEqual(['meta', 'transacoes'])
    expect(relatorio.map((r) => r.status)).toEqual(['ok', 'ok'])
    expect(arm.getItem('dashboard-financeiro')).toBeNull()
    expect(arm.getItem('dashboard-metas')).toBeNull()
  })

  it('meta do navegador não usada (a conta já tinha uma) vira cópia de segurança, não é descartada', async () => {
    const meta = JSON.stringify({ nome: 'Antiga', valor: 500, prazo: '2027-02' })
    const arm = armazenamentoFalso({ 'dashboard-metas': meta })
    const api = { post: async () => ({ resultado: { meta: { estado: 'mantida_do_servidor' } } }) }
    const { relatorio } = await migrar({ api, armazenamento: arm, userId: 'u1', agora })
    expect(relatorio[0]).toMatchObject({ id: 'meta', status: 'parcial', backup: 'dashboard-metas-backup-2026-10-20' })
    expect(arm.getItem('dashboard-metas-backup-2026-10-20')).toBe(meta)
    expect(arm.getItem('dashboard-metas')).toBeNull()
  })

  it('meta rejeitada pelo servidor: nada é apagado', async () => {
    const arm = armazenamentoFalso({ 'dashboard-metas': JSON.stringify({ valor: -1, prazo: 'x' }) })
    const api = { post: async () => ({ resultado: { meta: { estado: 'rejeitada', motivo: 'inválida' } } }) }
    const { relatorio } = await migrar({ api, armazenamento: arm, userId: 'u1', agora })
    expect(relatorio[0].status).toBe('erro')
    expect(arm.getItem('dashboard-metas')).not.toBeNull()
    expect(jaMigrada(arm, 'u1', 'meta')).toBe(false)
  })
})

describe('favoritos, agenda e lazer do navegador', () => {
  it('as três seções estão registradas, sem cópia local depois de confirmadas', () => {
    for (const [id, chave, resultado] of [['favoritos', 'dashboard-favoritos', 'favoritos'], ['lazer', 'dashboard-lazer', 'lazer'], ['agenda', 'dashboard-agenda', 'agenda']]) {
      expect(SECOES.find((x) => x.id === id)).toMatchObject({ chave, chaveResultado: resultado, manterLocal: false })
    }
  })

  const lazerLocal = [
    { id: 'a', tipo: 'jogo', titulo: 'Com capa', capa: { largura: 300, altura: 400, versao: 1 } },
    { id: 'b', tipo: 'filme', titulo: 'Sem capa', capa: null },
    { id: 'c', tipo: 'jogo', titulo: 'Capa sumida', capa: { largura: 100, altura: 100, versao: 1 } }
  ]
  const respostaLazer = { lazer: { recebidos: 3, importados: 3, jaExistiam: 0, rejeitados: [] }, mapaLazer: { a: 'novo-a', b: 'novo-b', c: 'novo-c' } }

  it('envia as capas ao id novo, remove só as enviadas e aceita arquivo ausente', async () => {
    const arm = armazenamentoFalso({ 'dashboard-lazer': JSON.stringify(lazerLocal) })
    const enviadas = []
    const apagadas = []
    const api = {
      post: async () => ({ resultado: respostaLazer }),
      enviarImagem: async (rota, blob, dims) => { enviadas.push([rota, blob, dims]) }
    }
    const capas = {
      ler: async (id) => (id === 'a' ? { blob: 'BLOB-A' } : null),
      excluir: async (id) => { apagadas.push(id) }
    }
    const { relatorio } = await migrar({ api, armazenamento: arm, userId: 'u1', secoes: SECOES.filter((s) => s.id === 'lazer'), agora, capas })
    expect(enviadas).toEqual([['/lazer/novo-a/capa', 'BLOB-A', { largura: 300, altura: 400 }]])
    expect(apagadas).toEqual(['a'])
    expect(relatorio[0]).toMatchObject({ status: 'ok', extra: { enviadas: 1, falhas: 0, semArquivo: 1 } })
    expect(arm.getItem('dashboard-lazer')).toBeNull()
    expect(jaMigrada(arm, 'u1', 'lazer')).toBe(true)
  })

  it('falha ao enviar uma capa: mantém tudo local e tenta de novo depois', async () => {
    const arm = armazenamentoFalso({ 'dashboard-lazer': JSON.stringify(lazerLocal) })
    const api = { post: async () => ({ resultado: respostaLazer }), enviarImagem: async () => { throw new Error('rede') } }
    const capas = { ler: async () => ({ blob: 'X' }), excluir: async () => { throw new Error('não deveria apagar') } }
    const { relatorio } = await migrar({ api, armazenamento: arm, userId: 'u1', secoes: SECOES.filter((s) => s.id === 'lazer'), agora, capas })
    expect(relatorio[0].status).toBe('incompleta')
    expect(arm.getItem('dashboard-lazer')).not.toBeNull()
    expect(jaMigrada(arm, 'u1', 'lazer')).toBe(false)
  })

  it('sem acesso às capas locais não apaga nada', async () => {
    const arm = armazenamentoFalso({ 'dashboard-lazer': JSON.stringify(lazerLocal) })
    const api = { post: async () => ({ resultado: respostaLazer }) }
    const { relatorio } = await migrar({ api, armazenamento: arm, userId: 'u1', secoes: SECOES.filter((s) => s.id === 'lazer'), agora })
    expect(relatorio[0].status).toBe('incompleta')
    expect(arm.getItem('dashboard-lazer')).not.toBeNull()
  })

  it('reexecução após falha: itens já existem, as capas pendentes são reenviadas', async () => {
    const arm = armazenamentoFalso({ 'dashboard-lazer': JSON.stringify(lazerLocal) })
    const api = {
      post: async () => ({ resultado: { lazer: { recebidos: 3, importados: 0, jaExistiam: 3, rejeitados: [] }, mapaLazer: respostaLazer.mapaLazer } }),
      enviarImagem: async () => {}
    }
    const capas = { ler: async (id) => (id === 'a' ? { blob: 'B' } : null), excluir: async () => {} }
    const { relatorio } = await migrar({ api, armazenamento: arm, userId: 'u1', secoes: SECOES.filter((s) => s.id === 'lazer'), agora, capas })
    expect(relatorio[0]).toMatchObject({ status: 'ok', extra: { enviadas: 1 } })
    expect(arm.getItem('dashboard-lazer')).toBeNull()
  })
})

describe('cache local pertence a uma conta', () => {
  it('registra o dono e descarta o cache ao limpar', () => {
    const arm = armazenamentoFalso({ 'dashboard-preferencias': '{}', 'dashboard-preferencias-pendente': '1' })
    definirDonoDoCache('u1', arm)
    expect(donoDoCache(arm)).toBe('u1')
    limparCache(arm)
    expect(arm.chaves()).toEqual([])
    expect(arm.getItem(CHAVE_DONO)).toBeNull()
  })
})
