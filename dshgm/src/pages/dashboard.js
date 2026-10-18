import { iniciarShell } from '../modules/shell.js'
import { iniciarRelogio } from '../modules/clock.js'
import { iniciarClima } from '../modules/weather.js'
import { iniciarTarefas } from '../modules/tarefas.js'
import { iniciarSpotify } from '../modules/spotify.js'
import { iniciarPesquisaGoogle } from '../modules/google-search.js'
import { iniciarAtalhos } from '../modules/favoritos.js'
import { iniciarAgendaInicio } from '../modules/agenda.js'
import { EVENTO, nomeExibicao } from '../modules/preferencias.js'
import { lerJSON } from '../services/storage.js'

// O shell injeta o menu lateral, o sprite de ícones, a conta e o painel de perfil.
iniciarShell({ pagina: 'inicio' })

iniciarRelogio()
iniciarClima()
iniciarTarefas()
iniciarSpotify()
iniciarPesquisaGoogle()
iniciarAtalhos()
iniciarAgendaInicio()

function iniciarSaudacao() {
  const titulo = document.querySelector('#welcome-title')
  const nome = document.querySelector('#welcome-name')

  if (!titulo) return

  function atualizarNome() {
    if (nome) nome.textContent = nomeExibicao()
  }

  function atualizarSaudacao() {
    const hora = new Date().getHours()

    if (hora >= 5 && hora < 12) {
      titulo.textContent = 'Bom dia,'
    } else if (hora >= 12 && hora < 18) {
      titulo.textContent = 'Boa tarde,'
    } else {
      titulo.textContent = 'Boa noite,'
    }
  }

  atualizarNome()
  atualizarSaudacao()
  setInterval(atualizarSaudacao, 60000)
  window.addEventListener(EVENTO, atualizarNome)
}

iniciarSaudacao()

// Saldo do mês atual, calculado a partir dos dados da tela financeira.
function iniciarSaldoDoMes() {
  const elemento = document.querySelector('#month-balance')
  if (!elemento) return

  const dados = lerJSON('dashboard-financeiro', null)
  if (!Array.isArray(dados) || dados.length === 0) return

  const agora = new Date()
  const prefixo = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`

  const saldo = dados
    .filter((item) => typeof item.date === 'string' && item.date.startsWith(prefixo))
    .reduce((total, item) => total + (item.type === 'income' ? item.amount : -item.amount), 0)

  elemento.textContent = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(saldo)
  elemento.classList.toggle('is-negative', saldo < 0)
}

iniciarSaldoDoMes()
