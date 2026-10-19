import { icon } from './icons.js'
import { chaveData, dataDeChave } from '../services/storage.js'
import { eventosApi } from '../services/eventosApi.js'
import {
  CATEGORIAS_EVENTO,
  DIAS_CURTOS,
  DIAS_LONGOS,
  RECORRENCIAS
} from './agenda-dados.js'
import { mostrarAviso } from './shell.js'

/* Pop-up de criação e edição de eventos, compartilhado pela página inicial e pela agenda. */

let dialogo = null
let refs = null
let contexto = null

function template() {
  const recorrencias = RECORRENCIAS.map((r) => `<option value="${r.id}">${r.nome}</option>`).join('')
  const categorias = CATEGORIAS_EVENTO.map(
    (c) => `<button type="button" data-cat="${c.id}" aria-pressed="false" style="--cat:${c.cor}"><i class="dot"></i>${c.nome}</button>`
  ).join('')

  return `
    <dialog class="modal" id="ev-dialog" aria-labelledby="ev-dialog-title">
      <form class="modal-form" id="ev-form" novalidate>
        <div class="modal-head">
          <div>
            <p class="kicker" id="ev-dialog-kicker">NOVO EVENTO</p>
            <h2 id="ev-dialog-title">Adicionar evento</h2>
          </div>
          <button class="icon-btn" id="ev-cancel-x" type="button" aria-label="Fechar">${icon('x')}</button>
        </div>

        <label class="field">
          Título
          <input id="ev-title" type="text" maxlength="100" autocomplete="off" placeholder="Ex.: Consulta, reunião, aniversário" />
        </label>

        <label class="field">
          <span id="ev-date-label">Data</span>
          <input id="ev-date" type="date" />
        </label>

        <label class="switch-row">
          <span>Dia inteiro</span>
          <input class="switch" id="ev-allday" type="checkbox" role="switch" />
        </label>

        <div class="field-row" id="ev-times">
          <label class="field">Início <input id="ev-start" type="time" /></label>
          <label class="field">Fim (opcional) <input id="ev-end" type="time" /></label>
        </div>

        <div class="field">
          Categoria
          <div class="cat-chips" id="ev-cats" role="group" aria-label="Categoria">${categorias}</div>
        </div>

        <label class="field">
          Repetição
          <select id="ev-rec">${recorrencias}</select>
        </label>

        <div class="field" id="ev-days-field" hidden>
          Repetir nos dias
          <div class="weekdays" id="ev-weekdays" role="group" aria-label="Dias da semana"></div>
        </div>

        <label class="field" id="ev-until-field" hidden>
          Repetir até (opcional)
          <input id="ev-until" type="date" />
        </label>

        <label class="field">
          Notas (opcional)
          <textarea id="ev-notes" maxlength="500" placeholder="Local, link, lembretes..."></textarea>
        </label>

        <p class="drawer-note" id="ev-series-note" hidden>As alterações valem para toda a série.</p>
        <p class="drawer-note" id="ev-sync-note" hidden></p>
        <p class="modal-error" id="ev-error" role="alert"></p>

        <div class="modal-actions">
          <button class="btn btn-danger" id="ev-delete" type="button" hidden>Excluir</button>
          <button class="btn btn-danger" id="ev-delete-one" type="button" hidden>Só esta</button>
          <span class="spacer"></span>
          <button class="btn" id="ev-cancel" type="button">Cancelar</button>
          <button class="btn btn-primary" type="submit">Salvar</button>
        </div>
      </form>
    </dialog>`
}

function montar() {
  if (dialogo) return
  document.body.insertAdjacentHTML('beforeend', template())
  dialogo = document.querySelector('#ev-dialog')

  const q = (id) => dialogo.querySelector(id)
  refs = {
    form: q('#ev-form'),
    titulo: q('#ev-title'),
    data: q('#ev-date'),
    rotuloData: q('#ev-date-label'),
    diaInteiro: q('#ev-allday'),
    horarios: q('#ev-times'),
    inicio: q('#ev-start'),
    fim: q('#ev-end'),
    categorias: q('#ev-cats'),
    rec: q('#ev-rec'),
    blocoDias: q('#ev-days-field'),
    dias: q('#ev-weekdays'),
    blocoAte: q('#ev-until-field'),
    ate: q('#ev-until'),
    notas: q('#ev-notes'),
    notaSerie: q('#ev-series-note'),
    notaSync: q('#ev-sync-note'),
    salvar: q('[type="submit"]'),
    erro: q('#ev-error'),
    excluir: q('#ev-delete'),
    excluirUma: q('#ev-delete-one')
  }

  DIAS_CURTOS.forEach((curto, i) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.dataset.dia = String(i)
    b.textContent = curto
    b.setAttribute('aria-label', DIAS_LONGOS[i])
    b.setAttribute('aria-pressed', 'false')
    b.addEventListener('click', () => b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')))
    refs.dias.append(b)
  })

  refs.categorias.addEventListener('click', (e) => {
    const botao = e.target.closest('[data-cat]')
    if (botao) marcarCategoria(botao.dataset.cat)
  })

  refs.diaInteiro.addEventListener('change', atualizarCampos)
  refs.rec.addEventListener('change', () => {
    if (refs.rec.value === 'semanal' && !diasMarcados().length) {
      marcarDias([dataDeChave(refs.data.value || chaveData()).getDay()])
    }
    atualizarCampos()
  })

  const fechar = () => dialogo.close()
  q('#ev-cancel').addEventListener('click', fechar)
  q('#ev-cancel-x').addEventListener('click', fechar)
  dialogo.addEventListener('click', (e) => {
    if (e.target === dialogo) fechar()
  })

  refs.form.addEventListener('submit', salvar)
  refs.excluir.addEventListener('click', excluirSerie)
  refs.excluirUma.addEventListener('click', excluirOcorrencia)
}

const diasMarcados = () =>
  [...refs.dias.children].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => Number(b.dataset.dia))

const marcarDias = (dias) =>
  [...refs.dias.children].forEach((b) => b.setAttribute('aria-pressed', String(dias.includes(Number(b.dataset.dia)))))

const categoriaAtual = () => refs.categorias.querySelector('[aria-pressed="true"]')?.dataset.cat ?? 'pessoal'

function marcarCategoria(id) {
  refs.categorias
    .querySelectorAll('[data-cat]')
    .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cat === id)))
}

function atualizarCampos() {
  const repete = refs.rec.value !== 'nenhuma'
  refs.horarios.hidden = refs.diaInteiro.checked
  refs.blocoDias.hidden = refs.rec.value !== 'semanal'
  refs.blocoAte.hidden = !repete
  refs.rotuloData.textContent = repete ? 'Data de início' : 'Data'
}

/**
 * Abre o pop-up.
 *  - evento: edita este evento (ocorrencia = data clicada, para "excluir só esta")
 *  - data: cria um novo evento nesta data
 *  - aposMudar: chamado depois de salvar ou excluir
 */
export function abrirEvento({ evento = null, data = chaveData(), ocorrencia = null, aposMudar = () => {} }) {
  montar()
  contexto = { evento, ocorrencia, aposMudar }
  refs.erro.textContent = ''

  dialogo.querySelector('#ev-dialog-title').textContent = evento ? 'Editar evento' : 'Adicionar evento'
  dialogo.querySelector('#ev-dialog-kicker').textContent = evento ? 'EDIÇÃO' : 'NOVO EVENTO'

  const recorrente = Boolean(evento && evento.rec.tipo !== 'nenhuma')

  refs.titulo.value = evento?.titulo ?? ''
  refs.data.value = evento?.data ?? data
  refs.diaInteiro.checked = evento ? evento.diaInteiro : false
  refs.inicio.value = evento?.inicio ?? ''
  refs.fim.value = evento?.fim ?? ''
  refs.rec.value = evento?.rec.tipo ?? 'nenhuma'
  refs.ate.value = evento?.rec.ate ?? ''
  refs.notas.value = evento?.notas ?? ''
  marcarCategoria(evento?.categoria ?? 'pessoal')
  marcarDias(evento?.rec.dias.length ? evento.rec.dias : [dataDeChave(refs.data.value).getDay()])

  refs.excluir.hidden = !evento
  refs.excluir.textContent = recorrente ? 'Excluir série' : 'Excluir'
  refs.excluirUma.hidden = !(recorrente && ocorrencia)
  refs.notaSerie.hidden = !recorrente

  // Situação no Google Calendar (quando conectado) e evento somente leitura.
  const sync = evento?.sincronizacao
  const somenteLeitura = Boolean(sync?.somenteLeitura)
  refs.salvar.disabled = somenteLeitura
  refs.excluirUma.hidden = refs.excluirUma.hidden || somenteLeitura
  refs.notaSync.hidden = true
  if (somenteLeitura) {
    refs.notaSync.textContent =
      'Este evento tem uma recorrência do Google Calendar que não pode ser editada aqui. Edite-o no Google Calendar (você ainda pode excluí-lo).'
    refs.notaSync.hidden = false
  } else if (sync?.estado === 'error') {
    refs.notaSync.textContent = `Não sincronizado com o Google Calendar: ${sync.erro ?? 'erro desconhecido'}. Tentaremos de novo.`
    refs.notaSync.hidden = false
  } else if (sync?.estado === 'pending') {
    refs.notaSync.textContent = 'Aguardando envio ao Google Calendar.'
    refs.notaSync.hidden = false
  }

  atualizarCampos()
  dialogo.showModal()
  refs.titulo.focus()
}

// Desabilita os botões de ação enquanto a API responde (evita envio duplo).
function ocupado(sim) {
  ;[refs.salvar, refs.excluir, refs.excluirUma].forEach((b) => {
    b.dataset.ocupado = sim ? '1' : ''
    if (sim) b.disabled = true
    else b.disabled = b === refs.salvar && Boolean(contexto?.evento?.sincronizacao?.somenteLeitura)
  })
}

const textoErro = (falha) => falha?.message || 'Não foi possível concluir a operação. Tente novamente.'

async function salvar(e) {
  e.preventDefault()
  const { evento, aposMudar } = contexto

  const titulo = refs.titulo.value.trim()
  const data = refs.data.value
  const diaInteiro = refs.diaInteiro.checked
  const tipo = refs.rec.value
  const dias = diasMarcados()

  if (!titulo) return erro('Informe o título do evento.', refs.titulo)
  if (!data) return erro('Escolha a data do evento.', refs.data)
  if (!diaInteiro && !refs.inicio.value) return erro('Informe o horário de início ou marque "Dia inteiro".', refs.inicio)
  if (!diaInteiro && refs.fim.value && refs.fim.value < refs.inicio.value) {
    return erro('O horário de fim deve ser depois do início.', refs.fim)
  }
  if (tipo === 'semanal' && !dias.length) return erro('Escolha pelo menos um dia da semana.')
  if (tipo !== 'nenhuma' && refs.ate.value && refs.ate.value < data) {
    return erro('A data final da repetição deve ser depois do início.', refs.ate)
  }

  const dados = {
    titulo,
    data,
    diaInteiro,
    inicio: diaInteiro ? '' : refs.inicio.value,
    fim: diaInteiro ? '' : refs.fim.value,
    categoria: categoriaAtual(),
    notas: refs.notas.value.trim(),
    rec: {
      tipo,
      dias: tipo === 'semanal' ? dias : [],
      ate: tipo !== 'nenhuma' ? refs.ate.value : ''
    }
  }

  ocupado(true)
  try {
    if (evento) {
      // Exceções anteriores à nova data de início deixam de fazer sentido.
      await eventosApi.atualizar(evento.id, { ...dados, excecoes: evento.excecoes.filter((d) => d >= data) })
    } else {
      await eventosApi.criar(dados)
    }
  } catch (falha) {
    ocupado(false)
    erro(textoErro(falha))
    return
  }
  ocupado(false)

  dialogo.close()
  mostrarAviso(evento ? 'Evento atualizado' : 'Evento criado')
  aposMudar(data)
}

function erro(texto, campo) {
  refs.erro.textContent = texto
  campo?.focus()
}

async function excluirSerie() {
  const { evento, aposMudar } = contexto
  const recorrente = evento.rec.tipo !== 'nenhuma'
  const pergunta = recorrente
    ? `Excluir toda a série "${evento.titulo}"?`
    : `Excluir o evento "${evento.titulo}"?`
  if (!confirm(pergunta)) return

  ocupado(true)
  try {
    await eventosApi.excluir(evento.id)
  } catch (falha) {
    ocupado(false)
    return erro(textoErro(falha))
  }
  ocupado(false)
  dialogo.close()
  mostrarAviso('Evento excluído')
  aposMudar()
}

async function excluirOcorrencia() {
  const { evento, ocorrencia, aposMudar } = contexto
  ocupado(true)
  try {
    await eventosApi.atualizar(evento.id, { excecoes: [...new Set([...evento.excecoes, ocorrencia])] })
  } catch (falha) {
    ocupado(false)
    return erro(textoErro(falha))
  }
  ocupado(false)
  dialogo.close()
  mostrarAviso('Ocorrência excluída')
  aposMudar()
}
