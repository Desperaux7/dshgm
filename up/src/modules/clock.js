import { EVENTO, lerPreferencias } from './preferencias.js'

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

export function iniciarRelogio() {
  const elementoRelogio = document.querySelector('#clock')
  const elementoData = document.querySelector('#current-date')
  let ultimoMinuto = ''

  const atualizar = () => {
    const agora = new Date()
    const horario = agora.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: !lerPreferencias().hora24
    })

    // Só mexe no DOM quando o minuto muda.
    if (horario === ultimoMinuto) return
    ultimoMinuto = horario

    if (elementoRelogio) {
      elementoRelogio.textContent = horario
      elementoRelogio.dateTime = agora.toISOString()
    }

    if (elementoData) {
      const dia = String(agora.getDate()).padStart(2, '0')
      elementoData.innerHTML =
        `<span>${DIAS[agora.getDay()]}</span>` +
        `<span>${dia} ${MESES[agora.getMonth()]} ${agora.getFullYear()}</span>`
    }
  }

  atualizar()
  setInterval(atualizar, 1000)

  // Mudar o formato da hora nas preferências vale na hora.
  window.addEventListener(EVENTO, () => {
    ultimoMinuto = ''
    atualizar()
  })
}
