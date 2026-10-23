import { icon } from './icons.js'
import { mostrarAviso } from './shell.js'
import { statusDoDia, tarefasApi } from '../services/tarefasApi.js'

const DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const DIAS_LONGOS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

/*
  Modelo de tarefa:
  {
    id, texto,
    tipo: 'unica' | 'recorrente',
    data: 'AAAA-MM-DD',     // só para tarefas únicas
    dias: [0..6],           // só para recorrentes (0 = domingo)
    criada: 'AAAA-MM-DD',   // recorrentes só aparecem a partir daqui
    concluidas: { 'AAAA-MM-DD': true },  // conclusão controlada dia a dia
    andamento: { 'AAAA-MM-DD': true }    // dias em que está "em andamento" (nunca junto com concluída)
  }
*/

const ROTULOS_STATUS = { pendente: 'Pendente', andamento: 'Em andamento', concluida: 'Concluída' }
// Clique no indicador: pendente → em andamento → concluída → pendente.
const PROXIMO_STATUS = { pendente: 'andamento', andamento: 'concluida', concluida: 'pendente' }

function chaveData(data = new Date()) {
  const mes = String(data.getMonth() + 1).padStart(2, '0')
  const dia = String(data.getDate()).padStart(2, '0')
  return `${data.getFullYear()}-${mes}-${dia}`
}

function diaDaSemana(chave) {
  return new Date(`${chave}T12:00:00`).getDay()
}

// Mensagem amigável para falhas da API (rede, validação, sessão).
function mensagemDe(erro) {
  return erro?.message || 'Não foi possível concluir a operação. Tente novamente.'
}

function apareceEm(tarefa, chave) {
  if (tarefa.tipo === 'unica') return tarefa.data === chave
  return tarefa.dias.includes(diaDaSemana(chave)) && chave >= tarefa.criada
}

function descreverDias(dias) {
  if (dias.length === 7) return 'Todos os dias'
  return dias.map((d) => DIAS_CURTOS[d]).join(', ')
}

export function iniciarTarefas() {
  const lista = document.querySelector('#task-list')
  const botaoAdicionar = document.querySelector('#task-add')
  const dialogo = document.querySelector('#task-dialog')

  if (!lista || !botaoAdicionar || !dialogo) return

  const contador = document.querySelector('#pending-count')
  const diaTexto = document.querySelector('#task-day')
  const progressoTexto = document.querySelector('#task-progress-label')
  const progressoBarra = document.querySelector('#task-progress-bar')

  const form = dialogo.querySelector('#task-form')
  const campoNome = dialogo.querySelector('#task-input')
  const campoData = dialogo.querySelector('#task-date')
  const blocoData = dialogo.querySelector('#task-date-field')
  const blocoDias = dialogo.querySelector('#task-days-field')
  const diasSemana = dialogo.querySelector('#task-weekdays')
  const botoesTipo = dialogo.querySelectorAll('[data-kind]')
  const erro = dialogo.querySelector('#task-error')
  const botaoExcluir = dialogo.querySelector('#task-delete-modal')
  const titulo = dialogo.querySelector('#task-dialog-title')
  const subtitulo = dialogo.querySelector('#task-dialog-kicker')

  let tarefas = []
  let carregado = false
  let erroCarga = ''
  let editando = null
  let tipoAtual = 'unica'
  let diaAtual = chaveData()

  /* ---------- Pop-up ---------- */

  DIAS_CURTOS.forEach((curto, indice) => {
    const botao = document.createElement('button')
    botao.type = 'button'
    botao.dataset.dia = String(indice)
    botao.textContent = curto
    botao.setAttribute('aria-label', DIAS_LONGOS[indice])
    botao.setAttribute('aria-pressed', 'false')
    botao.addEventListener('click', () => {
      botao.setAttribute('aria-pressed', String(botao.getAttribute('aria-pressed') !== 'true'))
    })
    diasSemana.append(botao)
  })

  function diasMarcados() {
    return [...diasSemana.children]
      .filter((b) => b.getAttribute('aria-pressed') === 'true')
      .map((b) => Number(b.dataset.dia))
  }

  function marcarDias(dias) {
    ;[...diasSemana.children].forEach((b) =>
      b.setAttribute('aria-pressed', String(dias.includes(Number(b.dataset.dia))))
    )
  }

  function definirTipo(tipo) {
    tipoAtual = tipo
    botoesTipo.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === tipo)))
    blocoData.hidden = tipo !== 'unica'
    blocoDias.hidden = tipo !== 'recorrente'
    erro.textContent = ''

    if (tipo === 'recorrente' && diasMarcados().length === 0) {
      marcarDias([new Date().getDay()])
    }
  }

  botoesTipo.forEach((b) => b.addEventListener('click', () => definirTipo(b.dataset.kind)))

  function abrirPopup(tarefa = null) {
    editando = tarefa
    erro.textContent = ''

    titulo.textContent = tarefa ? 'Editar tarefa' : 'Adicionar tarefa'
    subtitulo.textContent = tarefa ? 'EDIÇÃO' : 'NOVA TAREFA'
    botaoExcluir.hidden = !tarefa

    campoNome.value = tarefa?.texto ?? ''
    campoData.value = tarefa?.tipo === 'unica' ? tarefa.data : chaveData()
    marcarDias(tarefa?.tipo === 'recorrente' ? tarefa.dias : [])
    definirTipo(tarefa?.tipo ?? 'unica')

    dialogo.showModal()
    campoNome.focus()
  }

  function fecharPopup() {
    dialogo.close()
  }

  botaoAdicionar.addEventListener('click', () => abrirPopup())
  dialogo.querySelector('#task-cancel').addEventListener('click', fecharPopup)
  dialogo.querySelector('#task-cancel-x').addEventListener('click', fecharPopup)
  dialogo.addEventListener('click', (evento) => {
    if (evento.target === dialogo) fecharPopup()
  })

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault()

    const texto = campoNome.value.trim()
    const dias = diasMarcados()

    if (!texto) {
      erro.textContent = 'Informe o nome da tarefa.'
      campoNome.focus()
      return
    }

    if (tipoAtual === 'recorrente' && dias.length === 0) {
      erro.textContent = 'Escolha pelo menos um dia da semana.'
      return
    }

    if (tipoAtual === 'unica' && !campoData.value) {
      erro.textContent = 'Escolha a data da tarefa.'
      return
    }

    const virouRecorrente = editando && editando.tipo !== 'recorrente' && tipoAtual === 'recorrente'
    const criada = !editando || virouRecorrente ? chaveData() : editando.criada

    const corpo = { texto, tipo: tipoAtual, criada }
    if (tipoAtual === 'unica') corpo.data = campoData.value
    else corpo.dias = dias

    const botaoSalvar = form.querySelector('[type="submit"]')
    if (botaoSalvar) botaoSalvar.disabled = true // evita envio duplo enquanto a API responde

    try {
      if (editando) {
        // A conclusão de cada dia é preservada pelo servidor.
        const atualizada = await tarefasApi.atualizar(editando.id, corpo)
        tarefas = tarefas.map((t) => (t.id === editando.id ? atualizada : t))
      } else {
        tarefas = [...tarefas, await tarefasApi.criar(corpo)]
      }
    } catch (falha) {
      erro.textContent = mensagemDe(falha)
      return
    } finally {
      if (botaoSalvar) botaoSalvar.disabled = false
    }

    fecharPopup()
    renderizar()
  })

  /* ---------- Lista do dia ---------- */

  async function excluir(tarefa) {
    if (tarefa.tipo === 'recorrente') {
      const ok = confirm(
        `Excluir a tarefa recorrente "${tarefa.texto}"? Ela deixará de aparecer em todos os dias.`
      )
      if (!ok) return false
    }

    try {
      await tarefasApi.excluir(tarefa.id)
    } catch (falha) {
      mostrarAviso(mensagemDe(falha))
      return false
    }

    tarefas = tarefas.filter((t) => t.id !== tarefa.id)
    renderizar()
    return true
  }

  botaoExcluir.addEventListener('click', async () => {
    if (editando && (await excluir(editando))) fecharPopup()
  })

  function renderizar() {
    diaAtual = chaveData()
    const agora = new Date()

    if (!carregado) {
      lista.replaceChildren()
      const aviso = document.createElement('li')
      aviso.className = 'task-placeholder'
      aviso.textContent = erroCarga ? `${erroCarga} ` : 'Carregando tarefas...'
      if (erroCarga) {
        const tentar = document.createElement('button')
        tentar.type = 'button'
        tentar.className = 'link-btn'
        tentar.textContent = 'Tentar novamente'
        tentar.addEventListener('click', () => carregar())
        aviso.append(tentar)
      }
      lista.append(aviso)
      return
    }

    const visiveis = tarefas.filter((t) => apareceEm(t, diaAtual))
    const feitas = visiveis.filter((t) => statusDoDia(t, diaAtual) === 'concluida').length
    const emAndamento = visiveis.filter((t) => statusDoDia(t, diaAtual) === 'andamento').length

    if (diaTexto) {
      const dia = String(agora.getDate()).padStart(2, '0')
      diaTexto.textContent = `Hoje · ${DIAS_LONGOS[agora.getDay()]}, ${dia} ${MESES[agora.getMonth()]}`
    }

    if (contador) contador.textContent = String(visiveis.length - feitas)

    if (progressoTexto) {
      const andamento = emAndamento ? ` · ${emAndamento} em andamento` : ''
      progressoTexto.textContent = `${feitas} de ${visiveis.length} ${feitas === 1 ? 'concluída' : 'concluídas'}${andamento}`
    }

    if (progressoBarra) {
      progressoBarra.style.width = visiveis.length ? `${(feitas / visiveis.length) * 100}%` : '0%'
    }

    lista.replaceChildren()

    if (visiveis.length === 0) {
      const vazio = document.createElement('li')
      vazio.className = 'task-placeholder'
      vazio.textContent = 'Nenhuma tarefa prevista para hoje. Use o botão + para adicionar.'
      lista.append(vazio)
      return
    }

    // Troca o estado do dia na tela na hora; se a API falhar, só esse dia dessa tarefa volta ao que era.
    async function mudarStatus(tarefa, novo) {
      const dia = diaAtual
      const anterior = statusDoDia(tarefa, dia)
      if (novo === anterior) return

      const aplicar = (status) => {
        tarefas = tarefas.map((t) => {
          if (t.id !== tarefa.id) return t
          const concluidas = { ...t.concluidas }
          const andamento = { ...t.andamento }
          delete concluidas[dia]
          delete andamento[dia]
          if (status === 'concluida') concluidas[dia] = true
          if (status === 'andamento') andamento[dia] = true
          return { ...t, concluidas, andamento }
        })
        renderizar()
      }

      aplicar(novo)
      try {
        await tarefasApi.definirStatus(tarefa.id, dia, novo)
      } catch (falha) {
        aplicar(anterior)
        mostrarAviso(mensagemDe(falha))
      }
    }

    visiveis.forEach((tarefa) => {
      const status = statusDoDia(tarefa, diaAtual)
      const concluida = status === 'concluida'

      const item = document.createElement('li')
      item.className = `task-item${concluida ? ' completed' : ''}${status === 'andamento' ? ' in-progress' : ''}`
      item.dataset.status = status

      // Caixa de seleção: marca/desmarca a conclusão. "Em andamento" aparece como estado intermediário (traço).
      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.checked = concluida
      checkbox.indeterminate = status === 'andamento'
      checkbox.setAttribute('aria-label', `${concluida ? 'Reabrir' : 'Concluir'} ${tarefa.texto}`)
      checkbox.addEventListener('change', () => mudarStatus(tarefa, checkbox.checked ? 'concluida' : 'pendente'))

      const corpo = document.createElement('div')
      corpo.className = 'task-body'

      const nome = document.createElement('span')
      nome.className = 'task-name'
      nome.textContent = tarefa.texto

      const meta = document.createElement('span')
      meta.className = 'task-meta'

      // Indicador de status (também é o botão que avança o estado).
      const estado = document.createElement('button')
      estado.type = 'button'
      estado.className = `task-state is-${status}`
      estado.innerHTML = '<i class="task-state-dot" aria-hidden="true"></i>'
      estado.append(ROTULOS_STATUS[status])
      estado.title = `Alterar para: ${ROTULOS_STATUS[PROXIMO_STATUS[status]]}`
      estado.setAttribute('aria-label', `${tarefa.texto}: ${ROTULOS_STATUS[status]}. Alterar para ${ROTULOS_STATUS[PROXIMO_STATUS[status]].toLowerCase()}`)
      estado.addEventListener('click', () => mudarStatus(tarefa, PROXIMO_STATUS[status]))
      meta.append(estado)

      const frequencia = document.createElement('span')
      if (tarefa.tipo === 'recorrente') {
        frequencia.innerHTML = icon('repeat')
        frequencia.append(' ', descreverDias(tarefa.dias))
      } else {
        frequencia.textContent = 'Única'
      }
      meta.append(frequencia)

      corpo.append(nome, meta)

      const acoes = document.createElement('div')
      acoes.className = 'task-actions'

      const editar = document.createElement('button')
      editar.type = 'button'
      editar.className = 'task-edit'
      editar.innerHTML = icon('pencil')
      editar.title = 'Editar'
      editar.setAttribute('aria-label', `Editar ${tarefa.texto}`)
      editar.addEventListener('click', () => abrirPopup(tarefa))

      const remover = document.createElement('button')
      remover.type = 'button'
      remover.className = 'task-delete'
      remover.innerHTML = icon('trash')
      remover.title = 'Excluir'
      remover.setAttribute('aria-label', `Excluir ${tarefa.texto}`)
      remover.addEventListener('click', () => {
        excluir(tarefa)
      })

      acoes.append(editar, remover)
      item.append(checkbox, corpo, acoes)
      lista.append(item)
    })
  }

  async function carregar() {
    try {
      tarefas = await tarefasApi.listar()
      carregado = true
      erroCarga = ''
    } catch (falha) {
      erroCarga = `Não foi possível carregar as tarefas (${mensagemDe(falha)}).`
    }
    renderizar()
  }

  renderizar()
  carregar()

  // Virada do dia: a lista passa a mostrar as tarefas do novo dia.
  setInterval(() => {
    if (chaveData() !== diaAtual) renderizar()
  }, 30000)

  // Ao voltar para a aba, traz alterações feitas em outro dispositivo ou aba.
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden || !carregado) return
    try {
      tarefas = await tarefasApi.listar()
      renderizar()
    } catch {
      /* mantém o que já está na tela */
    }
  })
}
