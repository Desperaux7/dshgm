import { icon } from './icons.js'

const STORAGE_KEY = 'dashboard-tarefas'

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
    concluidas: { 'AAAA-MM-DD': true }  // conclusão controlada dia a dia
  }
*/

function chaveData(data = new Date()) {
  const mes = String(data.getMonth() + 1).padStart(2, '0')
  const dia = String(data.getDate()).padStart(2, '0')
  return `${data.getFullYear()}-${mes}-${dia}`
}

function diaDaSemana(chave) {
  return new Date(`${chave}T12:00:00`).getDay()
}

// Aceita tarefas do formato antigo ({ id, texto, concluida }) e normaliza tudo.
function normalizar(bruta) {
  if (!bruta || typeof bruta.texto !== 'string') return null

  const hoje = chaveData()
  const concluidas =
    bruta.concluidas && typeof bruta.concluidas === 'object'
      ? { ...bruta.concluidas }
      : bruta.concluida
        ? { [hoje]: true }
        : {}

  const recorrente = bruta.tipo === 'recorrente'
  const dias = Array.isArray(bruta.dias)
    ? [...new Set(bruta.dias.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : []

  return {
    id: bruta.id ?? crypto.randomUUID(),
    texto: bruta.texto,
    tipo: recorrente ? 'recorrente' : 'unica',
    data: typeof bruta.data === 'string' ? bruta.data : hoje,
    dias: recorrente ? dias : [],
    criada: typeof bruta.criada === 'string' ? bruta.criada : hoje,
    concluidas
  }
}

function carregarTarefas() {
  try {
    const dados = JSON.parse(localStorage.getItem(STORAGE_KEY))
    return Array.isArray(dados) ? dados.map(normalizar).filter(Boolean) : []
  } catch {
    return []
  }
}

function salvarTarefas(tarefas) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tarefas))
    return true
  } catch {
    alert('Não foi possível salvar as tarefas no navegador.')
    return false
  }
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

  let tarefas = carregarTarefas()
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

  form.addEventListener('submit', (evento) => {
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

    const anteriores = tarefas
    const virouRecorrente = editando && editando.tipo !== 'recorrente' && tipoAtual === 'recorrente'

    const dados = {
      texto,
      tipo: tipoAtual,
      data: tipoAtual === 'unica' ? campoData.value : editando?.data ?? chaveData(),
      dias: tipoAtual === 'recorrente' ? dias : [],
      criada: !editando || virouRecorrente ? chaveData() : editando.criada
    }

    if (editando) {
      // Atualiza no lugar: a conclusão de cada dia é preservada.
      tarefas = tarefas.map((t) => (t.id === editando.id ? { ...t, ...dados } : t))
    } else {
      tarefas = [...tarefas, { id: crypto.randomUUID(), concluidas: {}, ...dados }]
    }

    if (!salvarTarefas(tarefas)) {
      tarefas = anteriores
      return
    }

    fecharPopup()
    renderizar()
  })

  /* ---------- Lista do dia ---------- */

  function excluir(tarefa) {
    if (tarefa.tipo === 'recorrente') {
      const ok = confirm(
        `Excluir a tarefa recorrente "${tarefa.texto}"? Ela deixará de aparecer em todos os dias.`
      )
      if (!ok) return false
    }

    const anteriores = tarefas
    tarefas = tarefas.filter((t) => t.id !== tarefa.id)

    if (!salvarTarefas(tarefas)) {
      tarefas = anteriores
      return false
    }

    renderizar()
    return true
  }

  botaoExcluir.addEventListener('click', () => {
    if (editando && excluir(editando)) fecharPopup()
  })

  function renderizar() {
    diaAtual = chaveData()
    const agora = new Date()
    const visiveis = tarefas.filter((t) => apareceEm(t, diaAtual))
    const feitas = visiveis.filter((t) => t.concluidas[diaAtual]).length

    if (diaTexto) {
      const dia = String(agora.getDate()).padStart(2, '0')
      diaTexto.textContent = `Hoje · ${DIAS_LONGOS[agora.getDay()]}, ${dia} ${MESES[agora.getMonth()]}`
    }

    if (contador) contador.textContent = String(visiveis.length - feitas)

    if (progressoTexto) {
      progressoTexto.textContent = `${feitas} de ${visiveis.length} ${feitas === 1 ? 'concluída' : 'concluídas'}`
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

    visiveis.forEach((tarefa) => {
      const concluida = Boolean(tarefa.concluidas[diaAtual])

      const item = document.createElement('li')
      item.className = `task-item${concluida ? ' completed' : ''}`

      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.checked = concluida
      checkbox.setAttribute('aria-label', `${concluida ? 'Reabrir' : 'Concluir'} ${tarefa.texto}`)

      checkbox.addEventListener('change', () => {
        const anteriores = tarefas
        tarefas = tarefas.map((t) => {
          if (t.id !== tarefa.id) return t
          const concluidas = { ...t.concluidas }
          if (checkbox.checked) concluidas[diaAtual] = true
          else delete concluidas[diaAtual]
          return { ...t, concluidas }
        })

        if (!salvarTarefas(tarefas)) tarefas = anteriores
        renderizar()
      })

      const corpo = document.createElement('div')
      corpo.className = 'task-body'

      const nome = document.createElement('span')
      nome.className = 'task-name'
      nome.textContent = tarefa.texto

      const meta = document.createElement('span')
      meta.className = 'task-meta'

      const estado = document.createElement('span')
      estado.className = 'task-state'
      estado.textContent = concluida ? 'Concluída' : 'Pendente'
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
      remover.addEventListener('click', () => excluir(tarefa))

      acoes.append(editar, remover)
      item.append(checkbox, corpo, acoes)
      lista.append(item)
    })
  }

  // Normaliza e grava o formato novo (migra tarefas antigas uma única vez).
  if (tarefas.length) salvarTarefas(tarefas)
  renderizar()

  // Virada do dia: a lista passa a mostrar as tarefas do novo dia.
  setInterval(() => {
    if (chaveData() !== diaAtual) renderizar()
  }, 30000)

  // Mantém várias abas abertas sincronizadas.
  window.addEventListener('storage', (evento) => {
    if (evento.key === STORAGE_KEY) {
      tarefas = carregarTarefas()
      renderizar()
    }
  })
}
