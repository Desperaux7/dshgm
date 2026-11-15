import { EVENTO, modoAtual } from './preferencias.js'
import { resumoDosTimes, timesApi } from '../services/timesApi.js'

// Cartões de Times na página inicial (modo profissional): total de pessoas e lista dos times.
export function iniciarTimesInicio() {
  const total = document.querySelector('#teams-people')
  const resumo = document.querySelector('#teams-summary')
  const lista = document.querySelector('#teams-list')
  if (!total && !lista) return

  let carregado = false
  let carregando = false

  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`

  function renderizar(times) {
    const t = resumoDosTimes(times)
    if (total) total.textContent = String(t.colaboradores)
    if (resumo) {
      resumo.textContent = t.times
        ? `${plural(t.times, 'time', 'times')} · ${plural(t.melhoriasEmAberto, 'melhoria em aberto', 'melhorias em aberto')}`
        : 'Crie seu primeiro time'
    }
    if (!lista) return
    lista.replaceChildren()
    if (!times.length) {
      const vazio = document.createElement('li')
      vazio.className = 'task-placeholder'
      vazio.textContent = 'Nenhum time ainda. Abra Times para criar o primeiro.'
      lista.append(vazio)
      return
    }
    times.slice(0, 5).forEach((time) => {
      const li = document.createElement('li')
      const info = document.createElement('div')
      const nome = document.createElement('strong')
      nome.textContent = time.nome
      const setor = document.createElement('span')
      setor.textContent = time.setor || 'Setor não informado'
      info.append(nome, setor)
      const contagem = document.createElement('span')
      contagem.className = 'team-count'
      contagem.textContent = plural(time.colaboradores.length, 'pessoa', 'pessoas')
      li.append(info, contagem)
      lista.append(li)
    })
    if (times.length > 5) {
      const mais = document.createElement('li')
      mais.className = 'task-placeholder'
      mais.textContent = `+ ${times.length - 5} ${times.length - 5 === 1 ? 'time' : 'times'}`
      lista.append(mais)
    }
  }

  // Só busca no modo profissional (no pessoal os cartões nem aparecem).
  async function carregar() {
    if (carregando || modoAtual() !== 'profissional') return
    carregando = true
    try {
      renderizar(await timesApi.listar())
      carregado = true
    } catch {
      if (lista && !carregado) {
        lista.replaceChildren()
        const erro = document.createElement('li')
        erro.className = 'task-placeholder'
        erro.textContent = 'Não foi possível carregar os times agora.'
        lista.append(erro)
      }
    } finally {
      carregando = false
    }
  }

  carregar()
  window.addEventListener(EVENTO, () => {
    if (!carregado) carregar()
  })
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && carregado) carregar()
  })
}
