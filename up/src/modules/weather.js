// Clima via Open-Meteo (gratuito, sem chave).
import { EVENTO, lerPreferencias } from './preferencias.js'

const CACHE_KEY = 'dashboard-clima-v2'
const VALIDADE_MS = 30 * 60 * 1000
const LIMITE_CHUVA = 30 // % mínima para avisar de chuva

// [ícone, descrição]
function descrever(codigo, dia) {
  if (codigo === 0) return dia ? ['sun', 'Céu limpo'] : ['moon', 'Céu limpo']
  if (codigo === 1) return dia ? ['sun', 'Quase limpo'] : ['moon', 'Quase limpo']
  if (codigo === 2) return ['cloud-sun', 'Parcialmente nublado']
  if (codigo === 3) return ['cloud', 'Nublado']
  if (codigo === 45 || codigo === 48) return ['fog', 'Neblina']
  if (codigo >= 51 && codigo <= 57) return ['rain', 'Garoa']
  if (codigo >= 61 && codigo <= 67) return ['rain', 'Chuva']
  if (codigo >= 71 && codigo <= 77) return ['cloud', 'Neve']
  if (codigo >= 80 && codigo <= 82) return ['rain', 'Pancadas de chuva']
  if (codigo === 85 || codigo === 86) return ['cloud', 'Neve']
  if (codigo >= 95) return ['bolt', 'Tempestade']
  return ['cloud', 'Nublado']
}

const paraF = (c) => (c * 9) / 5 + 32
const formatarTemp = (c, unidade) => `${Math.round(unidade === 'F' ? paraF(c) : c)}°${unidade === 'F' ? 'F' : 'C'}`

/* ---------- Busca de cidade (geocodificação) ---------- */

export async function buscarCidade(nome) {
  const url =
    'https://geocoding-api.open-meteo.com/v1/search' +
    `?name=${encodeURIComponent(nome)}&count=1&language=pt&format=json`
  const resposta = await fetch(url)
  if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`)

  const { results } = await resposta.json()
  const r = results?.[0]
  if (!r) return null

  const rotulo = [r.name, r.admin1, r.country_code].filter(Boolean).join(', ')
  return { nome: rotulo, lat: Number(r.latitude.toFixed(2)), lon: Number(r.longitude.toFixed(2)) }
}

/* ---------- Dados ---------- */

function lerCache(chave) {
  try {
    const dados = JSON.parse(localStorage.getItem(CACHE_KEY))
    return dados && dados.chave === chave && Date.now() - dados.hora < VALIDADE_MS ? dados : null
  } catch {
    return null
  }
}

function gravarCache(dados) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(dados))
  } catch {
    /* sem cache */
  }
}

function posicao() {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000, maximumAge: 3600000 })
  )
}

async function obterCoordenadas(cidade) {
  if (cidade) return { lat: cidade.lat, lon: cidade.lon }
  if (!('geolocation' in navigator)) throw new Error('Sem geolocalização')

  // Se a permissão já foi negada, não insiste a cada nova aba.
  const permissao = await navigator.permissions?.query({ name: 'geolocation' }).catch(() => null)
  if (permissao?.state === 'denied') throw new Error('Permissão negada')

  const { coords } = await posicao()
  return { lat: Number(coords.latitude.toFixed(2)), lon: Number(coords.longitude.toFixed(2)) }
}

async function buscarPrevisao({ lat, lon }) {
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,apparent_temperature,weather_code,is_day' +
    '&hourly=precipitation_probability' +
    '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    '&timezone=auto&forecast_days=2'
  const resposta = await fetch(url)
  if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`)
  return resposta.json()
}

// Resume a chance de chuva nas próximas 12 horas e no dia.
function resumir(dados) {
  const { current, hourly, daily } = dados
  const horas = hourly.time.map((t, i) => ({ t, p: hourly.precipitation_probability[i] ?? 0 }))
  const agora = current.time
  const proximas = horas.filter((h) => h.t >= agora.slice(0, 13) + ':00').slice(0, 12)
  const pico = proximas.reduce((melhor, h) => (h.p > melhor.p ? h : melhor), { p: 0, t: '' })

  return {
    temp: current.temperature_2m,
    sensacao: current.apparent_temperature,
    codigo: current.weather_code,
    dia: current.is_day === 1,
    min: daily.temperature_2m_min[0],
    max: daily.temperature_2m_max[0],
    chanceDia: daily.precipitation_probability_max[0] ?? 0,
    chuvaPico: pico.p,
    chuvaHora: pico.t ? Number(pico.t.slice(11, 13)) : null
  }
}

/* ---------- Exibição ---------- */

function exibir(dados, prefs) {
  const raiz = document.querySelector('#weather')
  if (!raiz) return

  if (!prefs.clima.ativo || !dados) {
    raiz.hidden = true
    return
  }

  const u = prefs.clima.unidade
  const [icone, texto] = descrever(dados.codigo, dados.dia)

  document.querySelector('#weather-icon use')?.setAttribute('href', `#i-${icone}`)
  document.querySelector('#weather-temp').textContent = formatarTemp(dados.temp, u)
  document.querySelector('#weather-cond').textContent = texto

  const chuva = document.querySelector('#weather-rain')
  const textoChuva = document.querySelector('#weather-rain-text')
  const provavel = dados.chuvaPico >= LIMITE_CHUVA

  chuva.classList.toggle('is-likely', provavel)
  textoChuva.textContent = provavel
    ? `Chuva ${dados.chuvaPico}% por volta das ${dados.chuvaHora}h`
    : 'Sem chuva nas próximas horas'

  const local = prefs.clima.cidade ? `${prefs.clima.cidade.nome}\n` : ''
  raiz.title =
    `${local}${texto}, sensação de ${formatarTemp(dados.sensacao, u)}\n` +
    `Mín ${formatarTemp(dados.min, u)} · Máx ${formatarTemp(dados.max, u)}\n` +
    `Chance de chuva hoje: ${dados.chanceDia}%`

  raiz.hidden = false
}

export async function iniciarClima() {
  if (!document.querySelector('#weather')) return

  let dados = null
  let carregando = null

  async function carregar() {
    const prefs = lerPreferencias()
    if (!prefs.clima.ativo) return exibir(null, prefs)

    const chave = prefs.clima.cidade ? `${prefs.clima.cidade.lat},${prefs.clima.cidade.lon}` : 'auto'
    const cache = lerCache(chave)
    if (cache) {
      dados = cache.dados
      return exibir(dados, prefs)
    }

    try {
      const coordenadas = await obterCoordenadas(prefs.clima.cidade)
      dados = resumir(await buscarPrevisao(coordenadas))
      gravarCache({ chave, hora: Date.now(), dados })
      exibir(dados, lerPreferencias())
    } catch (erro) {
      console.info('Clima indisponível:', erro.message)
      exibir(null, prefs)
    }
  }

  const iniciar = () => (carregando = carregar().finally(() => (carregando = null)))
  iniciar()

  // Trocar unidade, cidade ou visibilidade nas preferências atualiza na hora.
  let anterior = JSON.stringify(lerPreferencias().clima)
  window.addEventListener(EVENTO, () => {
    const atual = JSON.stringify(lerPreferencias().clima)
    if (atual === anterior) return
    const mudouLocal = JSON.stringify(JSON.parse(anterior).cidade) !== JSON.stringify(lerPreferencias().clima.cidade)
    anterior = atual
    if (mudouLocal || (!dados && lerPreferencias().clima.ativo)) iniciar()
    else exibir(dados, lerPreferencias())
  })

  // Atualiza a previsão a cada 30 minutos com a aba aberta.
  setInterval(() => {
    if (!carregando) iniciar()
  }, VALIDADE_MS)
}
