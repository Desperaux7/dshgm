import { icon } from '../modules/icons.js'
import { iniciarShell, mostrarAviso } from '../modules/shell.js'
import { escaparHTML } from '../services/storage.js'
import { TIPOS_EVENTO, agruparPorSubtime, melhoriasEmAberto, timesApi, ultimoEvento } from '../services/timesApi.js'

iniciarShell({ pagina: 'times' })

const CHAVE_TIME_ATIVO = 'dashboard-time-ativo'
const MAX_LISTA = 30

const abas = document.querySelector('#team-tabs')
const visao = document.querySelector('#team-view')

let times = []
let carregado = false
let erroCarga = ''
let timeAtivoId = null

const textoErro = (erro) => erro?.message || 'Não foi possível concluir a operação. Tente novamente.'
const hoje = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const formatarData = (chave) => (chave ? chave.split('-').reverse().join('/') : '')
const rotuloTipo = (id) => TIPOS_EVENTO.find((t) => t.id === id)?.nome ?? 'Outro'

function lerTimeAtivo() {
  try {
    return localStorage.getItem(CHAVE_TIME_ATIVO)
  } catch {
    return null
  }
}
function salvarTimeAtivo(id) {
  try {
    localStorage.setItem(CHAVE_TIME_ATIVO, id ?? '')
  } catch {
    /* sem armazenamento: o time ativo só não é lembrado */
  }
}

const timeAtivo = () => times.find((t) => t.id === timeAtivoId) ?? null

/* ---------- Dados ---------- */

async function carregar() {
  try {
    times = await timesApi.listar()
    carregado = true
    erroCarga = ''
    if (!times.some((t) => t.id === timeAtivoId)) timeAtivoId = times.some((t) => t.id === lerTimeAtivo()) ? lerTimeAtivo() : (times[0]?.id ?? null)
  } catch (falha) {
    erroCarga = `Não foi possível carregar os times (${textoErro(falha)}).`
  }
  renderizar()
}

// Troca um colaborador/subtime dentro do estado local sem recarregar tudo.
const atualizarTimeLocal = (id, fn) => {
  times = times.map((t) => (t.id === id ? fn(t) : t))
}

/* ---------- Renderização ---------- */

function renderizarAbas() {
  abas.replaceChildren(
    ...times.map((time) => {
      const botao = document.createElement('button')
      botao.type = 'button'
      botao.textContent = `${time.nome} · ${time.colaboradores.length}`
      botao.setAttribute('aria-pressed', String(time.id === timeAtivoId))
      botao.addEventListener('click', () => {
        timeAtivoId = time.id
        salvarTimeAtivo(time.id)
        renderizar()
      })
      return botao
    })
  )
}

function mensagem(html, acao) {
  const caixa = document.createElement('div')
  caixa.className = 'empty-state'
  caixa.innerHTML = html
  if (acao) caixa.append(document.createElement('br'), acao)
  return caixa
}

function botao(texto, { classe = 'btn btn-sm', icone, aoClicar, titulo } = {}) {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = classe
  if (icone) b.innerHTML = icon(icone)
  if (texto) b.append(texto)
  if (titulo) {
    b.title = titulo
    b.setAttribute('aria-label', titulo)
  }
  b.addEventListener('click', aoClicar)
  return b
}

function criarCartao(colaborador, time) {
  const cartao = document.createElement('article')
  cartao.className = 'member-card'

  const topo = document.createElement('button')
  topo.type = 'button'
  topo.className = 'member-open'
  topo.setAttribute('aria-label', `Abrir cartão de ${colaborador.nome}`)
  topo.addEventListener('click', () => abrirColaborador(time, colaborador))

  const avatar = document.createElement('span')
  avatar.className = 'member-avatar'
  avatar.textContent = colaborador.nome.trim().charAt(0).toUpperCase() || '?'

  const texto = document.createElement('span')
  texto.className = 'member-id'
  const nome = document.createElement('strong')
  nome.textContent = colaborador.nome
  const cargo = document.createElement('span')
  cargo.textContent = colaborador.cargo || 'Sem cargo informado'
  texto.append(nome, cargo)
  topo.append(avatar, texto)
  cartao.append(topo)

  if (colaborador.pontosFortes.length) {
    const fortes = document.createElement('div')
    fortes.className = 'member-chips'
    colaborador.pontosFortes.slice(0, 3).forEach((p) => {
      const chip = document.createElement('span')
      chip.className = 'chip-tag is-strength'
      chip.textContent = p
      fortes.append(chip)
    })
    if (colaborador.pontosFortes.length > 3) {
      const mais = document.createElement('span')
      mais.className = 'chip-tag'
      mais.textContent = `+${colaborador.pontosFortes.length - 3}`
      fortes.append(mais)
    }
    cartao.append(fortes)
  }

  const abertas = melhoriasEmAberto(colaborador).length
  const feitas = colaborador.pontosMelhoria.length - abertas
  const meta = document.createElement('div')
  meta.className = 'member-meta'
  const melhoria = document.createElement('span')
  melhoria.className = abertas ? 'is-open' : ''
  melhoria.textContent = abertas ? `${abertas} ponto(s) de melhoria em aberto` : colaborador.pontosMelhoria.length ? 'Melhorias desenvolvidas' : 'Sem pontos de melhoria'
  meta.append(melhoria)
  if (feitas && abertas) {
    const ok = document.createElement('span')
    ok.className = 'is-done'
    ok.textContent = `${feitas} desenvolvido(s)`
    meta.append(ok)
  }
  const evento = ultimoEvento(colaborador)
  if (evento) {
    const ev = document.createElement('span')
    ev.textContent = `${rotuloTipo(evento.tipo)} · ${formatarData(evento.data)}`
    ev.title = evento.texto
    meta.append(ev)
  }
  cartao.append(meta)
  return cartao
}

function renderizarTime() {
  const time = timeAtivo()
  visao.replaceChildren()
  if (!time) return

  const cabecalho = document.createElement('div')
  cabecalho.className = 'team-head'
  const titulo = document.createElement('div')
  const h2 = document.createElement('h2')
  h2.textContent = time.nome
  const setor = document.createElement('p')
  setor.textContent = time.setor ? `Setor: ${time.setor}` : 'Setor não informado'
  titulo.append(h2, setor)

  const acoes = document.createElement('div')
  acoes.className = 'team-actions'
  acoes.append(
    botao('Colaborador', { classe: 'btn btn-sm btn-primary', icone: 'plus', aoClicar: () => abrirColaborador(time, null) }),
    botao('Subtime', { icone: 'plus', aoClicar: () => abrirSubtime(time, null) }),
    botao('', { classe: 'icon-btn', icone: 'pencil', titulo: 'Editar time', aoClicar: () => abrirTime(time) })
  )
  cabecalho.append(titulo, acoes)
  visao.append(cabecalho)

  const grupos = agruparPorSubtime(time)
  const semSubtimes = time.subtimes.length === 0

  if (!time.colaboradores.length && semSubtimes) {
    visao.append(mensagem('<strong>Nenhum colaborador ainda</strong>Adicione as pessoas do time e, se quiser, organize-as em subtimes.', botao('Adicionar o primeiro colaborador', { classe: 'btn btn-primary', icone: 'plus', aoClicar: () => abrirColaborador(time, null) })))
    return
  }

  grupos.forEach(({ subtime, colaboradores }) => {
    // O grupo "sem subtime" só aparece quando tem gente ou quando não há subtimes.
    if (!subtime && !colaboradores.length && !semSubtimes) return

    const secao = document.createElement('section')
    secao.className = 'sub-section'

    if (subtime || !semSubtimes) {
      const cab = document.createElement('div')
      cab.className = 'sub-head'
      const nome = document.createElement('h3')
      nome.textContent = subtime ? subtime.nome : 'Sem subtime'
      const total = document.createElement('small')
      total.textContent = `${colaboradores.length} ${colaboradores.length === 1 ? 'pessoa' : 'pessoas'}`
      cab.append(nome, total)
      if (subtime) cab.append(botao('', { classe: 'icon-btn', icone: 'pencil', titulo: `Editar subtime ${subtime.nome}`, aoClicar: () => abrirSubtime(time, subtime) }))
      secao.append(cab)
    }

    const grade = document.createElement('div')
    grade.className = 'member-grid'
    if (colaboradores.length) grade.append(...colaboradores.map((c) => criarCartao(c, time)))
    else {
      const vazio = document.createElement('p')
      vazio.className = 'sub-empty'
      vazio.textContent = 'Ninguém neste subtime ainda.'
      grade.append(vazio)
    }
    secao.append(grade)
    visao.append(secao)
  })
}

function renderizar() {
  if (!carregado) {
    abas.replaceChildren()
    visao.replaceChildren()
    const tentar = erroCarga ? botao('Tentar novamente', { aoClicar: carregar }) : null
    visao.append(mensagem(escaparHTML(erroCarga || 'Carregando...'), tentar))
    return
  }
  renderizarAbas()
  if (!times.length) {
    visao.replaceChildren(
      mensagem('<strong>Nenhum time ainda</strong>Crie um time com nome e setor e depois adicione os colaboradores.', botao('Criar o primeiro time', { classe: 'btn btn-primary', icone: 'plus', aoClicar: () => abrirTime(null) }))
    )
    return
  }
  renderizarTime()
}

/* ---------- Pop-ups simples ---------- */

function ligarFechar(dialogo) {
  dialogo.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dialogo.close()))
  dialogo.addEventListener('click', (e) => {
    if (e.target === dialogo) dialogo.close()
  })
}

// Time
const dlgTime = document.querySelector('#team-dialog')
const frmTime = document.querySelector('#team-form')
const campoNomeTime = document.querySelector('#team-name')
const campoSetorTime = document.querySelector('#team-sector')
const erroTime = document.querySelector('#team-error')
const excluirTime = document.querySelector('#team-delete')
let editandoTime = null
ligarFechar(dlgTime)

function abrirTime(time) {
  editandoTime = time
  erroTime.textContent = ''
  document.querySelector('#team-dialog-kicker').textContent = time ? 'EDIÇÃO' : 'NOVO TIME'
  document.querySelector('#team-dialog-title').textContent = time ? 'Editar time' : 'Adicionar time'
  excluirTime.hidden = !time
  campoNomeTime.value = time?.nome ?? ''
  campoSetorTime.value = time?.setor ?? ''
  dlgTime.showModal()
  campoNomeTime.focus()
}
document.querySelector('#team-new').addEventListener('click', () => abrirTime(null))

frmTime.addEventListener('submit', async (e) => {
  e.preventDefault()
  const nome = campoNomeTime.value.trim()
  if (!nome) {
    erroTime.textContent = 'Informe o nome da equipe.'
    campoNomeTime.focus()
    return
  }
  const dados = { nome, setor: campoSetorTime.value.trim() }
  const enviar = frmTime.querySelector('[type="submit"]')
  enviar.disabled = true
  try {
    if (editandoTime) {
      const atualizado = await timesApi.atualizarTime(editandoTime.id, dados)
      atualizarTimeLocal(editandoTime.id, (t) => ({ ...t, ...atualizado }))
    } else {
      const criado = await timesApi.criarTime(dados)
      times = [...times, criado]
      timeAtivoId = criado.id
      salvarTimeAtivo(criado.id)
    }
  } catch (falha) {
    erroTime.textContent = textoErro(falha)
    return
  } finally {
    enviar.disabled = false
  }
  dlgTime.close()
  renderizar()
  mostrarAviso('Time salvo')
})

excluirTime.addEventListener('click', async () => {
  if (!editandoTime) return
  const n = editandoTime.colaboradores.length
  const aviso = `Excluir o time "${editandoTime.nome}"? ${n ? `Os ${n} colaborador(es) e os subtimes dele também serão excluídos.` : 'Os subtimes dele também serão excluídos.'}`
  if (!confirm(aviso)) return
  try {
    await timesApi.excluirTime(editandoTime.id)
  } catch (falha) {
    erroTime.textContent = textoErro(falha)
    return
  }
  const id = editandoTime.id
  times = times.filter((t) => t.id !== id)
  if (timeAtivoId === id) timeAtivoId = times[0]?.id ?? null
  dlgTime.close()
  renderizar()
  mostrarAviso('Time excluído')
})

// Subtime
const dlgSub = document.querySelector('#sub-dialog')
const frmSub = document.querySelector('#sub-form')
const campoNomeSub = document.querySelector('#sub-name')
const erroSub = document.querySelector('#sub-error')
const excluirSub = document.querySelector('#sub-delete')
let subTime = null
let editandoSub = null
ligarFechar(dlgSub)

function abrirSubtime(time, subtime) {
  subTime = time
  editandoSub = subtime
  erroSub.textContent = ''
  document.querySelector('#sub-dialog-kicker').textContent = subtime ? 'EDIÇÃO' : 'NOVO SUBTIME'
  document.querySelector('#sub-dialog-title').textContent = subtime ? 'Editar subtime' : 'Adicionar subtime'
  excluirSub.hidden = !subtime
  document.querySelector('#sub-note').hidden = !subtime
  campoNomeSub.value = subtime?.nome ?? ''
  dlgSub.showModal()
  campoNomeSub.focus()
}

frmSub.addEventListener('submit', async (e) => {
  e.preventDefault()
  const nome = campoNomeSub.value.trim()
  if (!nome) {
    erroSub.textContent = 'Informe o nome do subtime.'
    campoNomeSub.focus()
    return
  }
  const enviar = frmSub.querySelector('[type="submit"]')
  enviar.disabled = true
  try {
    if (editandoSub) {
      const atualizado = await timesApi.renomearSubtime(editandoSub.id, nome)
      atualizarTimeLocal(subTime.id, (t) => ({ ...t, subtimes: t.subtimes.map((s) => (s.id === atualizado.id ? atualizado : s)) }))
    } else {
      const criado = await timesApi.criarSubtime(subTime.id, nome)
      atualizarTimeLocal(subTime.id, (t) => ({ ...t, subtimes: [...t.subtimes, criado] }))
    }
  } catch (falha) {
    erroSub.textContent = textoErro(falha)
    return
  } finally {
    enviar.disabled = false
  }
  dlgSub.close()
  renderizar()
  mostrarAviso('Subtime salvo')
})

excluirSub.addEventListener('click', async () => {
  if (!editandoSub) return
  if (!confirm(`Excluir o subtime "${editandoSub.nome}"? As pessoas dele continuam no time, sem subtime.`)) return
  try {
    await timesApi.excluirSubtime(editandoSub.id)
  } catch (falha) {
    erroSub.textContent = textoErro(falha)
    return
  }
  const id = editandoSub.id
  atualizarTimeLocal(subTime.id, (t) => ({
    ...t,
    subtimes: t.subtimes.filter((s) => s.id !== id),
    colaboradores: t.colaboradores.map((c) => (c.subtimeId === id ? { ...c, subtimeId: null } : c))
  }))
  dlgSub.close()
  renderizar()
  mostrarAviso('Subtime excluído')
})

/* ---------- Pop-up de colaborador ---------- */

const dlgMembro = document.querySelector('#member-dialog')
const frmMembro = document.querySelector('#member-form')
const campoNome = document.querySelector('#member-name')
const campoCargo = document.querySelector('#member-role')
const campoSub = document.querySelector('#member-sub')
const blocoSub = document.querySelector('#member-sub-field')
const campoPerfil = document.querySelector('#member-profile')
const listaFortes = document.querySelector('#member-strengths')
const listaMelhorias = document.querySelector('#member-improvements')
const listaEventos = document.querySelector('#member-events')
const erroMembro = document.querySelector('#member-error')
const excluirMembro = document.querySelector('#member-delete')
let membroTime = null
let editandoMembro = null
ligarFechar(dlgMembro)

function removerLinha(li, lista, botaoAdicionar) {
  li.remove()
  botaoAdicionar.hidden = lista.children.length >= MAX_LISTA
}

function criarBotaoRemover(li, lista, botaoAdicionar, rotulo) {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'icon-btn'
  b.innerHTML = icon('x')
  b.title = rotulo
  b.setAttribute('aria-label', rotulo)
  b.addEventListener('click', () => removerLinha(li, lista, botaoAdicionar))
  return b
}

function campoTexto({ valor = '', placeholder, max, rotulo }) {
  const i = document.createElement('input')
  i.type = 'text'
  i.maxLength = max
  i.value = valor
  i.placeholder = placeholder
  i.setAttribute('aria-label', rotulo)
  return i
}

const btnAddForte = document.querySelector('#member-strength-add')
const btnAddMelhoria = document.querySelector('#member-improvement-add')
const btnAddEvento = document.querySelector('#member-event-add')

function linhaForte(texto = '') {
  const li = document.createElement('li')
  const campo = campoTexto({ valor: texto, placeholder: 'Ex.: Empatia no atendimento', max: 150, rotulo: 'Ponto forte' })
  li.append(campo, criarBotaoRemover(li, listaFortes, btnAddForte, 'Remover ponto forte'))
  listaFortes.append(li)
  btnAddForte.hidden = listaFortes.children.length >= MAX_LISTA
  return campo
}

function linhaMelhoria(p = {}) {
  const li = document.createElement('li')
  li.className = 'row-improvement'
  li.dataset.id = p.id ?? ''
  li.dataset.desenvolvidoEm = p.desenvolvidoEm ?? ''

  const texto = campoTexto({ valor: p.texto ?? '', placeholder: 'Ponto de melhoria', max: 200, rotulo: 'Ponto de melhoria' })
  texto.dataset.campo = 'texto'
  const evidencia = campoTexto({ valor: p.evidencia ?? '', placeholder: 'Evidência (ex.: protocolo 2026-0045)', max: 500, rotulo: 'Evidência do ponto de melhoria' })
  evidencia.dataset.campo = 'evidencia'

  const rotulo = document.createElement('label')
  rotulo.className = 'row-check'
  const caixa = document.createElement('input')
  caixa.type = 'checkbox'
  caixa.checked = Boolean(p.desenvolvido)
  caixa.dataset.campo = 'desenvolvido'
  rotulo.append(caixa, p.desenvolvido && p.desenvolvidoEm ? `Desenvolvido em ${formatarData(p.desenvolvidoEm)}` : 'Desenvolvido')
  caixa.addEventListener('change', () => li.classList.toggle('is-developed', caixa.checked))
  li.classList.toggle('is-developed', caixa.checked)

  li.append(texto, evidencia, rotulo, criarBotaoRemover(li, listaMelhorias, btnAddMelhoria, 'Remover ponto de melhoria'))
  listaMelhorias.append(li)
  btnAddMelhoria.hidden = listaMelhorias.children.length >= MAX_LISTA
  return texto
}

function linhaEvento(ev = {}) {
  const li = document.createElement('li')
  li.className = 'row-event'
  li.dataset.id = ev.id ?? ''

  const tipo = document.createElement('select')
  tipo.dataset.campo = 'tipo'
  tipo.setAttribute('aria-label', 'Tipo do evento')
  TIPOS_EVENTO.forEach((t) => tipo.append(new Option(t.nome, t.id)))
  tipo.value = ev.tipo ?? 'feedback'

  const data = document.createElement('input')
  data.type = 'date'
  data.value = ev.data ?? hoje()
  data.dataset.campo = 'data'
  data.setAttribute('aria-label', 'Data do evento')

  const texto = campoTexto({ valor: ev.texto ?? '', placeholder: 'O que aconteceu?', max: 1000, rotulo: 'Descrição do evento' })
  texto.dataset.campo = 'texto'

  li.append(tipo, data, texto, criarBotaoRemover(li, listaEventos, btnAddEvento, 'Remover evento'))
  listaEventos.append(li)
  btnAddEvento.hidden = listaEventos.children.length >= MAX_LISTA * 3
  return texto
}

btnAddForte.addEventListener('click', () => linhaForte().focus())
btnAddMelhoria.addEventListener('click', () => linhaMelhoria().focus())
btnAddEvento.addEventListener('click', () => linhaEvento().focus())

function abrirColaborador(time, colaborador) {
  membroTime = time
  editandoMembro = colaborador
  erroMembro.textContent = ''
  document.querySelector('#member-dialog-kicker').textContent = colaborador ? 'EDIÇÃO' : 'NOVO COLABORADOR'
  document.querySelector('#member-dialog-title').textContent = colaborador ? colaborador.nome : 'Adicionar colaborador'
  excluirMembro.hidden = !colaborador

  campoNome.value = colaborador?.nome ?? ''
  campoCargo.value = colaborador?.cargo ?? ''
  campoPerfil.value = colaborador?.perfil ?? ''

  blocoSub.hidden = time.subtimes.length === 0
  campoSub.replaceChildren(new Option('Sem subtime', ''), ...time.subtimes.map((s) => new Option(s.nome, s.id)))
  campoSub.value = colaborador?.subtimeId ?? ''

  listaFortes.replaceChildren()
  listaMelhorias.replaceChildren()
  listaEventos.replaceChildren()
  ;(colaborador?.pontosFortes ?? []).forEach((p) => linhaForte(p))
  ;(colaborador?.pontosMelhoria ?? []).forEach((p) => linhaMelhoria(p))
  ;[...(colaborador?.eventos ?? [])].sort((a, b) => b.data.localeCompare(a.data)).forEach((ev) => linhaEvento(ev))
  btnAddForte.hidden = listaFortes.children.length >= MAX_LISTA
  btnAddMelhoria.hidden = listaMelhorias.children.length >= MAX_LISTA

  dlgMembro.showModal()
  campoNome.focus()
}

// Lê o formulário e valida. Devolve { dados } ou { erro, campo }.
function lerFormularioColaborador() {
  const nome = campoNome.value.trim()
  if (!nome) return { erro: 'Informe o nome do colaborador.', campo: campoNome }

  const pontosFortes = [...listaFortes.querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean)

  const pontosMelhoria = []
  for (const li of listaMelhorias.querySelectorAll('li')) {
    const texto = li.querySelector('[data-campo="texto"]')
    const evidencia = li.querySelector('[data-campo="evidencia"]')
    const desenvolvido = li.querySelector('[data-campo="desenvolvido"]').checked
    if (!texto.value.trim() && !evidencia.value.trim()) continue // linha vazia: ignora
    if (!texto.value.trim()) return { erro: 'Descreva o ponto de melhoria.', campo: texto }
    // Regra do módulo: ponto de melhoria exige evidência (ex.: protocolo).
    if (!evidencia.value.trim()) return { erro: `Informe a evidência (ex.: protocolo) do ponto de melhoria "${texto.value.trim()}".`, campo: evidencia }
    pontosMelhoria.push({
      id: li.dataset.id || null,
      texto: texto.value.trim(),
      evidencia: evidencia.value.trim(),
      desenvolvido,
      desenvolvidoEm: desenvolvido ? li.dataset.desenvolvidoEm || null : null
    })
  }

  const eventos = []
  for (const li of listaEventos.querySelectorAll('li')) {
    const texto = li.querySelector('[data-campo="texto"]')
    const data = li.querySelector('[data-campo="data"]')
    if (!texto.value.trim()) continue
    if (!data.value) return { erro: 'Informe a data do evento.', campo: data }
    eventos.push({ id: li.dataset.id || null, tipo: li.querySelector('[data-campo="tipo"]').value, texto: texto.value.trim(), data: data.value })
  }

  return {
    dados: {
      nome,
      cargo: campoCargo.value.trim(),
      subtimeId: campoSub.value || null,
      pontosFortes,
      pontosMelhoria,
      eventos,
      perfil: campoPerfil.value.trim()
    }
  }
}

frmMembro.addEventListener('submit', async (e) => {
  e.preventDefault()
  const { dados, erro, campo } = lerFormularioColaborador()
  if (erro) {
    erroMembro.textContent = erro
    campo.focus()
    return
  }
  const enviar = frmMembro.querySelector('[type="submit"]')
  enviar.disabled = true
  const novo = !editandoMembro
  try {
    if (editandoMembro) {
      const atualizado = await timesApi.atualizarColaborador(editandoMembro.id, dados)
      atualizarTimeLocal(membroTime.id, (t) => ({ ...t, colaboradores: t.colaboradores.map((c) => (c.id === atualizado.id ? atualizado : c)) }))
    } else {
      const criado = await timesApi.criarColaborador(membroTime.id, dados)
      atualizarTimeLocal(membroTime.id, (t) => ({ ...t, colaboradores: [...t.colaboradores, criado] }))
    }
  } catch (falha) {
    erroMembro.textContent = textoErro(falha)
    return
  } finally {
    enviar.disabled = false
  }
  dlgMembro.close()
  renderizar()
  mostrarAviso(novo ? 'Colaborador adicionado' : 'Cartão atualizado')
})

excluirMembro.addEventListener('click', async () => {
  if (!editandoMembro) return
  if (!confirm(`Excluir o cartão de "${editandoMembro.nome}"? Esta ação não pode ser desfeita.`)) return
  try {
    await timesApi.excluirColaborador(editandoMembro.id)
  } catch (falha) {
    erroMembro.textContent = textoErro(falha)
    return
  }
  const id = editandoMembro.id
  atualizarTimeLocal(membroTime.id, (t) => ({ ...t, colaboradores: t.colaboradores.filter((c) => c.id !== id) }))
  dlgMembro.close()
  renderizar()
  mostrarAviso('Colaborador excluído')
})

// Ao voltar para a aba, traz alterações feitas em outro dispositivo (sem interromper um pop-up aberto).
document.addEventListener('visibilitychange', async () => {
  if (document.hidden || !carregado || document.querySelector('dialog[open]')) return
  try {
    times = await timesApi.listar()
    renderizar()
  } catch {
    /* mantém o que já está na tela */
  }
})

renderizar()
carregar()
