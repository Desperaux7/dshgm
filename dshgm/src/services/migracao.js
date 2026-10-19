// Migração dos dados antigos do navegador (localStorage) para a conta autenticada.
//
// Regras:
//  - só roda depois do login, enviando tudo a POST /api/importacao (idempotente: repetir não duplica);
//  - o dado local só é apagado depois que o servidor confirma TODOS os registros;
//  - se algum registro for rejeitado, o original vai para uma cópia de segurança (nunca é perdido);
//  - se os números não fecharem, nada é apagado.

// Cada seção descreve uma chave do localStorage e como ela entra no corpo da importação.
// `manterLocal`: a chave continua existindo como cache (preferências); as demais são removidas após a migração.
// Novas seções são ativadas aqui à medida que cada módulo passa a usar a API.
export const SECOES = [
  {
    id: 'preferencias',
    chave: 'dashboard-preferencias',
    rotulo: 'Preferências e perfil',
    tipo: 'estado',
    manterLocal: true,
    chaveResultado: 'preferencias',
    corpo: (dados) => ({ preferencias: dados })
  },
  {
    id: 'tarefas',
    chave: 'dashboard-tarefas',
    rotulo: 'Tarefas',
    tipo: 'lista',
    manterLocal: false,
    chaveResultado: 'tarefas',
    corpo: (dados) => ({ tarefas: tarefasLegado(dados) })
  },
  {
    id: 'financeiro',
    chave: 'dashboard-financeiro',
    rotulo: 'Movimentações financeiras',
    tipo: 'lista',
    manterLocal: false,
    chaveResultado: 'transacoes',
    corpo: (dados) => ({ transacoes: dados })
  },
  {
    // A meta só entra se a conta ainda não tiver uma; a do navegador nunca é descartada em silêncio.
    id: 'meta',
    chave: 'dashboard-metas',
    rotulo: 'Meta financeira',
    tipo: 'estado',
    estadosOk: ['importada', 'mantida_do_servidor'],
    manterLocal: false,
    chaveResultado: 'meta',
    corpo: (dados) => ({ meta: dados })
  },
  {
    id: 'favoritos',
    chave: 'dashboard-favoritos',
    rotulo: 'Favoritos',
    tipo: 'lista',
    manterLocal: false,
    chaveResultado: 'favoritos',
    corpo: (dados) => ({ favoritos: dados })
  },
  {
    // As capas ficam no IndexedDB do navegador: são enviadas uma a uma depois que os itens existem na conta.
    id: 'lazer',
    chave: 'dashboard-lazer',
    rotulo: 'Biblioteca de lazer',
    tipo: 'lista',
    manterLocal: false,
    chaveResultado: 'lazer',
    corpo: (dados) => ({ lazer: dados }),
    aposImportar: enviarCapasLegado
  },
  {
    id: 'agenda',
    chave: 'dashboard-agenda',
    rotulo: 'Agenda',
    tipo: 'lista',
    manterLocal: false,
    chaveResultado: 'agenda',
    corpo: (dados) => ({ agenda: dados })
  }
]

// Tarefas do formato mais antigo ({ id, texto, concluida }) viram o formato com conclusão por dia,
// como o módulo de tarefas sempre fez ao carregar. Itens inválidos seguem inalterados: o servidor os
// rejeita e o original fica na cópia de segurança (nada é descartado em silêncio).
export function tarefasLegado(dados, hoje = new Date()) {
  if (!Array.isArray(dados)) return []
  const mes = String(hoje.getMonth() + 1).padStart(2, '0')
  const dia = String(hoje.getDate()).padStart(2, '0')
  const chaveHoje = `${hoje.getFullYear()}-${mes}-${dia}`
  return dados.map((t) => {
    if (!t || typeof t.texto !== 'string') return t
    const concluidas = t.concluidas && typeof t.concluidas === 'object' ? t.concluidas : t.concluida ? { [chaveHoje]: true } : {}
    return { ...t, concluidas, data: typeof t.data === 'string' ? t.data : chaveHoje, criada: typeof t.criada === 'string' ? t.criada : chaveHoje }
  })
}

// Envia as capas do IndexedDB para os itens recém-importados (mapaLazer: id antigo -> id na conta).
//  - capa enviada com sucesso: o arquivo local é removido;
//  - arquivo ausente/ilegível: não bloqueia a migração (não há o que enviar);
//  - falha ao enviar: conta como falha, e a migração será repetida no próximo acesso (é idempotente).
// `capas`: { ler(idAntigo) -> { blob, largura?, altura? } | null, excluir(idAntigo) }
export async function enviarCapasLegado({ dados, resultado, api, capas }) {
  const mapa = resultado?.mapaLazer ?? {}
  const total = { enviadas: 0, falhas: 0, semArquivo: 0 }
  if (!Array.isArray(dados)) return total

  for (const item of dados) {
    if (!item || !item.capa) continue
    const idAntigo = String(item.id)
    const idNovo = mapa[idAntigo]
    if (!idNovo) continue // item rejeitado pelo servidor: o original fica na cópia de segurança

    let capa = null
    try {
      capa = await capas.ler(idAntigo)
    } catch {
      total.semArquivo++
      continue
    }
    if (!capa) {
      total.semArquivo++
      continue
    }

    try {
      await api.enviarImagem(`/lazer/${idNovo}/capa`, capa.blob, {
        largura: capa.largura ?? item.capa.largura,
        altura: capa.altura ?? item.capa.altura
      })
      total.enviadas++
    } catch {
      total.falhas++
      continue
    }
    try {
      await capas.excluir(idAntigo)
    } catch {
      /* cópia local que sobra é inofensiva */
    }
  }
  return total
}

const marca = (userId, id) => `dshgm-migrado:${userId}:${id}`

export function jaMigrada(armazenamento, userId, id) {
  try {
    return armazenamento.getItem(marca(userId, id)) !== null
  } catch {
    return false
  }
}

// Lê o que existe localmente e ainda não foi migrado por este usuário.
export function lerPendencias({ armazenamento, userId, secoes = SECOES }) {
  const pendentes = []
  for (const secao of secoes) {
    if (jaMigrada(armazenamento, userId, secao.id)) continue
    let bruto
    try {
      bruto = armazenamento.getItem(secao.chave)
    } catch {
      continue
    }
    if (bruto === null) continue
    let dados
    try {
      dados = JSON.parse(bruto)
    } catch {
      continue // JSON corrompido: não há o que importar (o original é preservado)
    }
    const vazio = dados === null || (Array.isArray(dados) && !dados.length) || (typeof dados === 'object' && !Object.keys(dados).length)
    if (!vazio) pendentes.push({ secao, bruto, dados })
  }
  return pendentes
}

function avaliar(secao, r) {
  if (!r) return { status: 'erro', detalhe: 'Sem resposta do servidor para esta seção.' }

  if (secao.tipo === 'estado') {
    const ok = secao.estadosOk ?? ['importadas', 'mantidas_do_servidor']
    if (ok.includes(r.estado)) return { status: 'ok', detalhe: r.estado }
    if (r.estado === 'foto_ignorada') return { status: 'parcial', detalhe: 'A foto era grande demais e não foi importada.' }
    return { status: 'erro', detalhe: 'O servidor rejeitou os dados.' }
  }

  const rejeitados = r.rejeitados ?? []
  // Todo registro enviado precisa estar importado, já existir no servidor ou constar como rejeitado.
  const contabilizados = (r.importados ?? 0) + (r.jaExistiam ?? 0) + rejeitados.length
  if (contabilizados !== r.recebidos) return { status: 'erro', detalhe: 'Os totais não conferem.' }
  return {
    status: rejeitados.length ? 'parcial' : 'ok',
    importados: r.importados,
    jaExistiam: r.jaExistiam,
    rejeitados
  }
}

export async function migrar({ api, armazenamento, userId, secoes = SECOES, agora = () => new Date(), capas = null }) {
  const pendentes = lerPendencias({ armazenamento, userId, secoes })
  if (!pendentes.length) return { relatorio: [], resposta: null }

  const corpo = Object.assign({}, ...pendentes.map((p) => p.secao.corpo(p.dados)))
  const { resultado } = await api.post('/importacao', corpo)

  const relatorio = []
  for (const { secao, bruto, dados } of pendentes) {
    const avaliacao = avaliar(secao, resultado[secao.chaveResultado])
    const item = { id: secao.id, rotulo: secao.rotulo, ...avaliacao, backup: null }

    // Passos extras (ex.: capas). Se algum falhar, nada local é apagado e a migração será tentada de novo.
    if ((avaliacao.status === 'ok' || avaliacao.status === 'parcial') && secao.aposImportar) {
      let extra
      try {
        extra = capas ? await secao.aposImportar({ dados, resultado, api, capas }) : { falhas: 1 }
      } catch {
        extra = { falhas: 1 }
      }
      item.extra = extra
      if (extra.falhas > 0) {
        relatorio.push({ ...item, status: 'incompleta', detalhe: `${extra.falhas} capa(s) não puderam ser enviadas. Tentaremos de novo no próximo acesso; seus dados locais foram mantidos.` })
        continue
      }
    }

    if (avaliacao.status === 'ok' || avaliacao.status === 'parcial') {
      // A conta já tinha dado próprio (ex.: meta): o do navegador não foi usado, então vira cópia de segurança.
      const naoUsado = secao.tipo === 'estado' && avaliacao.detalhe === 'mantida_do_servidor' && !secao.manterLocal
      if (naoUsado) {
        avaliacao.status = 'parcial'
        item.status = 'parcial'
        item.detalhe = 'A conta já tinha esse dado, então o do navegador não foi usado.'
      }
      if ((naoUsado || (avaliacao.status === 'parcial' && avaliacao.rejeitados?.length)) && !secao.manterLocal) {
        // Guarda o original completo: os registros rejeitados continuam recuperáveis.
        item.backup = `${secao.chave}-backup-${agora().toISOString().slice(0, 10)}`
        armazenamento.setItem(item.backup, bruto)
      }
      if (!secao.manterLocal) armazenamento.removeItem(secao.chave)
      armazenamento.setItem(marca(userId, secao.id), agora().toISOString())
    }
    relatorio.push(item)
  }
  return { relatorio, resposta: resultado }
}
