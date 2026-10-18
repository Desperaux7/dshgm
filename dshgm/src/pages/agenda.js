import '../styles/main.css'
import '../styles/paginas.css'

import { iniciarShell } from '../modules/shell.js'
import { icon } from '../modules/icons.js'
import { EVENTO, lerPreferencias } from '../modules/preferencias.js'
import { chaveData, dataDeChave, somarDias } from '../services/storage.js'
import {
  CHAVE_AGENDA,
  DIAS_CURTOS,
  DIAS_LONGOS,
  MESES_LONGOS,
  carregarEventos,
  categoriaDe,
  descreverHorario,
  descreverRecorrencia,
  eventosDoDia
} from '../modules/agenda-dados.js'
import { abrirEvento } from '../modules/agenda-dialogo.js'

iniciarShell({ pagina: 'agenda' })

const titulo = document.querySelector('#cal-title')
const cabecalhoDias = document.querySelector('#cal-weekdays')
const grade = document.querySelector('#cal-grid')
const tituloDia = document.querySelector('#day-title')
const kickerDia = document.querySelector('#day-kicker')
const listaDia = document.querySelector('#day-list')

let eventos = carregarEventos()
let selecionado = chaveData()
let visivel = { ano: Number(selecionado.slice(0, 4)), mes: Number(selecionado.slice(5, 7)) } // mes: 1-12

const doisDigitos = (n) => String(n).padStart(2, '0')
const montarChave = (ano, mes, dia) => `${ano}-${doisDigitos(mes)}-${doisDigitos(dia)}`

/* ---------- Calendário ---------- */

function renderizarCabecalho() {
  const inicio = lerPreferencias().inicioSemana
  cabecalhoDias.replaceChildren(
    ...Array.from({ length: 7 }, (_, i) => {
      const span = document.createElement('span')
      span.textContent = DIAS_CURTOS[(inicio + i) % 7]
      return span
    })
  )
}

function renderizarGrade() {
  const inicioSemana = lerPreferencias().inicioSemana
  const primeiro = new Date(visivel.ano, visivel.mes - 1, 1, 12)
  const deslocamento = (primeiro.getDay() - inicioSemana + 7) % 7
  const total = Math.ceil((deslocamento + new Date(visivel.ano, visivel.mes, 0).getDate()) / 7) * 7
  const hoje = chaveData()

  titulo.textContent = `${MESES_LONGOS[visivel.mes - 1]} ${visivel.ano}`
  grade.replaceChildren()

  for (let i = 0; i < total; i++) {
    const data = new Date(visivel.ano, visivel.mes - 1, 1 - deslocamento + i, 12)
    const chave = chaveData(data)
    const doMes = data.getMonth() === visivel.mes - 1
    const doDia = eventosDoDia(eventos, chave)

    const celula = document.createElement('button')
    celula.type = 'button'
    celula.className = 'cal-day'
    celula.dataset.data = chave
    celula.classList.toggle('is-outside', !doMes)
    celula.classList.toggle('is-today', chave === hoje)
    celula.classList.toggle('is-selected', chave === selecionado)
    celula.setAttribute('role', 'gridcell')
    celula.setAttribute('aria-selected', String(chave === selecionado))
    celula.tabIndex = chave === selecionado ? 0 : -1
    celula.setAttribute(
      'aria-label',
      `${DIAS_LONGOS[data.getDay()]}, ${data.getDate()} de ${MESES_LONGOS[data.getMonth()]}` +
        (doDia.length ? `, ${doDia.length} ${doDia.length === 1 ? 'evento' : 'eventos'}` : '')
    )

    const numero = document.createElement('span')
    numero.className = 'cal-num'
    numero.textContent = String(data.getDate())
    celula.append(numero)

    if (doDia.length) {
      const chips = document.createElement('span')
      chips.className = 'cal-chips'
      doDia.slice(0, 2).forEach((e) => {
        const chip = document.createElement('span')
        chip.className = 'cal-chip'
        chip.style.setProperty('--cat', categoriaDe(e.categoria).cor)
        chip.textContent = e.titulo
        chips.append(chip)
      })
      if (doDia.length > 2) {
        const mais = document.createElement('span')
        mais.className = 'cal-more'
        mais.textContent = `+${doDia.length - 2}`
        chips.append(mais)
      }

      const pontos = document.createElement('span')
      pontos.className = 'cal-dots'
      doDia.slice(0, 3).forEach((e) => {
        const ponto = document.createElement('i')
        ponto.style.setProperty('--cat', categoriaDe(e.categoria).cor)
        pontos.append(ponto)
      })

      celula.append(chips, pontos)
    }

    grade.append(celula)
  }
}

grade.addEventListener('click', (e) => {
  const celula = e.target.closest('.cal-day')
  if (celula) selecionar(celula.dataset.data)
})

// Setas navegam pelos dias; PageUp/PageDown trocam o mês.
grade.addEventListener('keydown', (e) => {
  const passos = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
  if (e.key in passos) {
    e.preventDefault()
    selecionar(somarDias(selecionado, passos[e.key]), { foco: true })
  } else if (e.key === 'PageUp' || e.key === 'PageDown') {
    e.preventDefault()
    mudarMes(e.key === 'PageUp' ? -1 : 1, { foco: true })
  }
})

function selecionar(chave, { foco = false } = {}) {
  selecionado = chave
  visivel = { ano: Number(chave.slice(0, 4)), mes: Number(chave.slice(5, 7)) }
  renderizar()
  if (foco) grade.querySelector('.is-selected')?.focus()
}

function mudarMes(delta, { foco = false } = {}) {
  const alvo = new Date(visivel.ano, visivel.mes - 1 + delta, 1, 12)
  const ultimo = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate()
  const dia = Math.min(Number(selecionado.slice(8, 10)), ultimo)
  selecionar(montarChave(alvo.getFullYear(), alvo.getMonth() + 1, dia), { foco })
}

document.querySelector('#cal-prev').addEventListener('click', () => mudarMes(-1))
document.querySelector('#cal-next').addEventListener('click', () => mudarMes(1))
document.querySelector('#cal-today').addEventListener('click', () => selecionar(chaveData()))

/* ---------- Compromissos do dia ---------- */

function renderizarDia() {
  const d = dataDeChave(selecionado)
  const hoje = chaveData()

  kickerDia.textContent =
    selecionado === hoje ? 'HOJE' : selecionado === somarDias(hoje, 1) ? 'AMANHÃ' : DIAS_LONGOS[d.getDay()].toUpperCase()
  tituloDia.textContent = `${d.getDate()} de ${MESES_LONGOS[d.getMonth()]}`
  listaDia.replaceChildren()

  const doDia = eventosDoDia(eventos, selecionado)

  if (!doDia.length) {
    const vazio = document.createElement('li')
    vazio.className = 'empty-state'
    vazio.innerHTML = '<strong>Dia livre</strong>Nenhum compromisso para esta data.'
    listaDia.append(vazio)
    return
  }

  doDia.forEach((evento) => {
    const cat = categoriaDe(evento.categoria)

    const item = document.createElement('li')
    const botao = document.createElement('button')
    botao.type = 'button'
    botao.className = 'day-event'
    botao.style.setProperty('--cat', cat.cor)

    const hora = document.createElement('span')
    hora.className = 'day-time'
    hora.textContent = evento.diaInteiro ? 'Dia todo' : evento.inicio
    if (evento.fim) {
      const fim = document.createElement('small')
      fim.textContent = evento.fim
      hora.append(fim)
    }

    const corpo = document.createElement('span')
    corpo.className = 'day-body'
    const nome = document.createElement('strong')
    nome.textContent = evento.titulo
    const meta = document.createElement('small')
    const rec = descreverRecorrencia(evento)
    meta.append(cat.nome)
    if (rec) {
      const r = document.createElement('span')
      r.innerHTML = `${icon('repeat')}`
      r.append(` ${rec}`)
      r.className = 'day-rec'
      meta.append(' · ', r)
    }
    corpo.append(nome, meta)

    if (evento.notas) {
      const notas = document.createElement('p')
      notas.className = 'day-notes'
      notas.textContent = evento.notas
      corpo.append(notas)
    }

    botao.append(hora, corpo)
    botao.title = `${evento.titulo} · ${descreverHorario(evento)}`
    botao.addEventListener('click', () =>
      abrirEvento({ evento, ocorrencia: selecionado, aposMudar: recarregar })
    )
    item.append(botao)
    listaDia.append(item)
  })
}

document.querySelector('#day-add').addEventListener('click', () =>
  abrirEvento({ data: selecionado, aposMudar: recarregar })
)

/* ---------- Atualização ---------- */

function renderizar() {
  renderizarGrade()
  renderizarDia()
}

function recarregar(dataNova) {
  eventos = carregarEventos()
  if (typeof dataNova === 'string' && dataNova) {
    selecionado = dataNova
    visivel = { ano: Number(dataNova.slice(0, 4)), mes: Number(dataNova.slice(5, 7)) }
  }
  renderizar()
}

window.addEventListener('storage', (e) => {
  if (e.key === CHAVE_AGENDA) recarregar()
})

// Mudar o início da semana nas preferências redesenha o calendário.
window.addEventListener(EVENTO, () => {
  renderizarCabecalho()
  renderizar()
})

renderizarCabecalho()
renderizar()
