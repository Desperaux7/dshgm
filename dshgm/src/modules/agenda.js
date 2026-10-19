import { icon } from './icons.js'
import { chaveData, dataDeChave } from '../services/storage.js'
import {
  MESES_CURTOS,
  carregarEventos,
  categoriaDe,
  descreverHorario,
  descreverRecorrencia,
  proximasOcorrencias,
  rotuloDia
} from './agenda-dados.js'
import { abrirEvento } from './agenda-dialogo.js'
import { calendarioApi, mudouAgenda } from '../services/calendarioApi.js'

/* ---------- Agenda na página inicial ---------- */

export function iniciarAgendaInicio() {
  const lista = document.querySelector('#agenda-upcoming')
  const tituloProximo = document.querySelector('#next-event-title')
  const quandoProximo = document.querySelector('#next-event-when')
  const botaoNovo = document.querySelector('#agenda-add')
  if (!lista) return

  let eventos = []

  function renderizar() {
    const proximas = proximasOcorrencias(eventos, { limite: 4 })

    if (tituloProximo && quandoProximo) {
      if (proximas.length) {
        const { evento, data } = proximas[0]
        tituloProximo.textContent = evento.titulo
        quandoProximo.textContent = `${rotuloDia(data)} · ${descreverHorario(evento)}`
      } else {
        tituloProximo.textContent = 'Sem eventos'
        quandoProximo.textContent = 'Sua agenda aparecerá aqui'
      }
    }

    lista.replaceChildren()

    if (!proximas.length) {
      const vazio = document.createElement('li')
      vazio.className = 'agenda-empty'
      vazio.innerHTML = `<span class="empty-icon">${icon('calendar')}</span><strong>Nada marcado por enquanto</strong><p>Seus próximos compromissos aparecerão aqui.</p>`
      lista.append(vazio)
      return
    }

    proximas.forEach(({ evento, data }) => {
      const d = dataDeChave(data)
      const cat = categoriaDe(evento.categoria)

      const item = document.createElement('li')
      const botao = document.createElement('button')
      botao.type = 'button'
      botao.className = 'agenda-item'
      botao.style.setProperty('--cat', cat.cor)
      botao.setAttribute('aria-label', `${evento.titulo}, ${rotuloDia(data)}, ${descreverHorario(evento)}. Abrir`)

      const dia = document.createElement('span')
      dia.className = 'agenda-date'
      dia.innerHTML = `<b>${String(d.getDate()).padStart(2, '0')}</b><small>${MESES_CURTOS[d.getMonth()]}</small>`

      const corpo = document.createElement('span')
      corpo.className = 'agenda-body'
      const titulo = document.createElement('strong')
      titulo.textContent = evento.titulo
      const meta = document.createElement('small')
      const recorrencia = descreverRecorrencia(evento)
      meta.textContent = `${rotuloDia(data)} · ${descreverHorario(evento)}${recorrencia ? ` · ${recorrencia}` : ''}`
      corpo.append(titulo, meta)

      botao.append(dia, corpo)
      botao.addEventListener('click', () => abrirEvento({ evento, ocorrencia: data, aposMudar: carregar }))
      item.append(botao)
      lista.append(item)
    })
  }

  botaoNovo?.addEventListener('click', () => abrirEvento({ data: chaveData(), aposMudar: carregar }))

  async function carregar() {
    try {
      eventos = await carregarEventos()
    } catch {
      /* sem resposta: mantém o que já está na tela */
    }
    renderizar()
  }

  // Sincroniza com o Google Calendar em segundo plano (o servidor limita a 1x a cada 30 s).
  async function sincronizarSilencioso() {
    try {
      if (mudouAgenda(await calendarioApi.sincronizar(false))) await carregar()
    } catch {
      /* a agenda segue funcionando com o que já está salvo */
    }
  }

  carregar().then(sincronizarSilencioso)

  // Ao voltar para a aba, traz alterações feitas em outro dispositivo, aba ou no Google Calendar.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) carregar().then(sincronizarSilencioso)
  })

  // Passagem do tempo: eventos de hoje que terminam saem da lista.
  setInterval(renderizar, 60000)
}
