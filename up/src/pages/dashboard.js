import { iniciarShell } from '../modules/shell.js'
import { iniciarRelogio } from '../modules/clock.js'
import { iniciarClima } from '../modules/weather.js'
import { iniciarTarefas } from '../modules/tarefas.js'
import { iniciarSpotify } from '../modules/spotify.js'
import { iniciarPesquisaGoogle } from '../modules/google-search.js'
import { iniciarAtalhos } from '../modules/favoritos.js'
import { iniciarAgendaInicio } from '../modules/agenda.js'
import { EVENTO, nomeSaudacao } from '../modules/preferencias.js'
import { financeiroApi } from '../services/financeiroApi.js'

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

  // Sem nome na conta, a saudação fica só com "Bom dia" (nada de nome fixo para quem não é o dono do código).
  function atualizar() {
    const hora = new Date().getHours()
    const saudacao = hora >= 5 && hora < 12 ? 'Bom dia' : hora >= 12 && hora < 18 ? 'Boa tarde' : 'Boa noite'
    const nomeAtual = nomeSaudacao()

    titulo.textContent = nomeAtual ? `${saudacao},` : saudacao
    if (nome) nome.textContent = nomeAtual
  }

  atualizar()
  setInterval(atualizar, 60000)
  window.addEventListener(EVENTO, atualizar)
}

iniciarSaudacao()

// Saldo do mês atual: calculado pelo servidor a partir das movimentações da conta
// (receitas − despesas − guardado, a mesma regra da tela Financeiro).
async function iniciarSaldoDoMes() {
  const elemento = document.querySelector('#month-balance')
  if (!elemento) return

  const agora = new Date()
  const mes = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`

  try {
    const resumo = await financeiroApi.resumo(mes)
    if (!resumo.entradas && !resumo.despesas && !resumo.guardado) return // sem movimentações: mantém o valor inicial

    elemento.textContent = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(resumo.saldo)
    elemento.classList.toggle('is-negative', resumo.saldo < 0)
  } catch {
    /* sem resposta do servidor: mantém o valor inicial */
  }
}

iniciarSaldoDoMes()
