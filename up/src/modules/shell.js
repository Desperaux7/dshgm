import { icon, injetarIcones } from './icons.js'
import { EVENTO, aplicarPreferencias, fotoPerfil, nomeExibicao } from './preferencias.js'
import { iniciarPerfil } from './perfil.js'
import { encerrarSessao } from '../services/conta.js'

const MENU_KEY = 'dashboard-menu'

const LINKS = [
  { id: 'inicio', href: 'index.html', icone: 'home', texto: 'Início' },
  { id: 'tarefas', href: 'index.html#tarefas', icone: 'tasks', texto: 'Tarefas' },
  { id: 'agenda', href: 'agenda.html', icone: 'calendar', texto: 'Agenda' },
  { id: 'favoritos', href: 'favoritos.html', icone: 'bookmark', texto: 'Favoritos' },
  { id: 'lazer', href: 'lazer.html', icone: 'gamepad', texto: 'Lazer' },
  { id: 'financeiro', href: 'financeiro.html', icone: 'dollar', texto: 'Financeiro' },
  { id: 'graficos', href: 'financeiro.html#graficos', icone: 'chart', texto: 'Gráficos' },
  { id: 'spotify', href: 'index.html#spotify', icone: 'spotify', texto: 'Spotify' }
]

function lerMenu() {
  try {
    return localStorage.getItem(MENU_KEY) === 'open'
  } catch {
    return false
  }
}

function salvarMenu(aberto) {
  try {
    localStorage.setItem(MENU_KEY, aberto ? 'open' : 'closed')
  } catch {
    /* armazenamento indisponível: segue sem persistir */
  }
}

function avatarHTML() {
  const foto = fotoPerfil()
  return foto
    ? `<img src="${foto.replace(/"/g, '&quot;')}" alt="" />`
    : `<span>${nomeExibicao().charAt(0).toUpperCase()}</span>`
}

function templateSidebar() {
  const itens = LINKS.map(
    (l) => `
      <a class="nav-item" href="${l.href}" data-nav="${l.id}" title="${l.texto}">
        ${icon(l.icone)}<span class="nav-label">${l.texto}</span>
      </a>`
  ).join('')

  return `
    <aside class="sidebar" id="sidebar" aria-label="Menu principal">
      <div class="sidebar-head">
        <button class="icon-btn" id="sidebar-toggle" type="button"
          aria-controls="sidebar" aria-expanded="false" aria-label="Abrir menu">
          ${icon('menu')}
        </button>
        <span class="sidebar-title">MENU</span>
        <button class="icon-btn sidebar-chevron" id="sidebar-chevron" type="button"
          aria-controls="sidebar" aria-label="Expandir ou recolher menu">
          ${icon('chevron-right')}
        </button>
      </div>
      <nav class="sidebar-nav">${itens}</nav>
      <div class="sidebar-foot">
        <span class="status-dot"></span><span class="nav-label">DSHGM</span>
      </div>
    </aside>`
}

function templateConta() {
  return `
    <div class="account" id="account">
      <button class="avatar-btn" id="avatar-btn" type="button"
        aria-haspopup="dialog" aria-expanded="false" aria-controls="profile-drawer"
        aria-label="Abrir perfil e configurações">
        <span class="avatar-face">${avatarHTML()}</span>
        <span class="avatar-badge">${icon('settings')}</span>
      </button>
      <button class="logout-pill" id="logout-btn" type="button" data-action="logout">
        ${icon('logout')}<span>Sair</span>
      </button>
    </div>
    <div class="toast" id="toast" role="status" aria-live="polite"></div>`
}

export function mostrarAviso(texto) {
  const toast = document.querySelector('#toast')
  if (!toast) return
  toast.textContent = texto
  toast.classList.add('is-visible')
  clearTimeout(mostrarAviso.timer)
  mostrarAviso.timer = setTimeout(() => toast.classList.remove('is-visible'), 2200)
}

export function iniciarShell({ pagina }) {
  injetarIcones()

  const app = document.querySelector('.app')
  if (!app) return

  app.insertAdjacentHTML('afterbegin', templateSidebar())
  app.insertAdjacentHTML('beforeend', templateConta())

  const toggle = app.querySelector('#sidebar-toggle')
  const chevron = app.querySelector('#sidebar-chevron')

  // `persistir: false` é usado no recolhimento automático por rolagem: a escolha manual do usuário continua valendo.
  function definirMenu(aberto, { persistir = true } = {}) {
    app.classList.toggle('menu-open', aberto)
    toggle.setAttribute('aria-expanded', String(aberto))
    toggle.setAttribute('aria-label', aberto ? 'Recolher menu' : 'Abrir menu')
    if (persistir) salvarMenu(aberto)
    if (aberto) referenciaRolagem = window.scrollY
  }

  let referenciaRolagem = window.scrollY
  const alternar = () => definirMenu(!app.classList.contains('menu-open'))
  toggle.addEventListener('click', alternar)
  chevron.addEventListener('click', alternar)
  definirMenu(lerMenu())

  // Recolhe sozinho ao descer a página (depois de rolar uma distância curta a partir do ponto em que o menu abriu).
  const DISTANCIA_PARA_RECOLHER = 48
  let aguardandoQuadro = false
  window.addEventListener(
    'scroll',
    () => {
      if (aguardandoQuadro || !app.classList.contains('menu-open')) return
      aguardandoQuadro = true
      requestAnimationFrame(() => {
        aguardandoQuadro = false
        if (!app.classList.contains('menu-open')) return
        const y = window.scrollY
        if (y - referenciaRolagem > DISTANCIA_PARA_RECOLHER) definirMenu(false, { persistir: false })
        else if (y < referenciaRolagem) referenciaRolagem = y // subiu: a distância passa a contar a partir daqui
      })
    },
    { passive: true }
  )

  // Recolhe ao trocar de sessão: clicar em qualquer item do menu (outra página ou âncora da mesma página).
  // Gravado como recolhido para a página seguinte abrir com o menu fechado, sem "piscar" aberto.
  app.querySelector('.sidebar-nav').addEventListener('click', (e) => {
    if (e.target.closest('[data-nav]')) definirMenu(false)
  })
  window.addEventListener('hashchange', () => definirMenu(false, { persistir: false }))

  // Em telas pequenas o menu abre sobre o conteúdo: toque fora ou Esc fecha.
  const telaPequena = window.matchMedia('(max-width: 700px)')
  document.addEventListener('click', (e) => {
    if (telaPequena.matches && app.classList.contains('menu-open') && !e.target.closest('#sidebar')) {
      definirMenu(false)
    }
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && telaPequena.matches && app.classList.contains('menu-open')) {
      definirMenu(false)
    }
  })

  // Item ativo: página atual + âncora (quando houver)
  function marcarAtivo() {
    const hash = location.hash.replace('#', '')
    const ativo = hash && LINKS.some((l) => l.id === hash) ? hash : pagina
    app.querySelectorAll('[data-nav]').forEach((a) => {
      const atual = a.dataset.nav === ativo
      a.classList.toggle('active', atual)
      if (atual) a.setAttribute('aria-current', 'page')
      else a.removeAttribute('aria-current')
    })
  }
  marcarAtivo()
  window.addEventListener('hashchange', marcarAtivo)

  // Avatar do canto superior acompanha nome e foto escolhidos no painel.
  window.addEventListener(EVENTO, () => {
    const face = app.querySelector('.avatar-face')
    if (face) face.innerHTML = avatarHTML()
  })

  // Painel lateral direito (perfil e configurações)
  iniciarPerfil(app, { avisar: mostrarAviso })
  aplicarPreferencias()

  app.querySelector('#logout-btn')?.addEventListener('click', async (e) => {
    const botao = e.currentTarget
    botao.disabled = true
    try {
      await encerrarSessao()
    } catch {
      botao.disabled = false
      mostrarAviso('Não foi possível sair agora. Tente novamente.')
    }
  })
}
