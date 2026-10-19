import { perfil } from '../config.js'
import { icon } from './icons.js'
import { escaparHTML } from '../services/storage.js'
import { blobParaDataURL, redimensionarImagem } from '../services/imagens.js'
import {
  CARTOES,
  DESTAQUES,
  EVENTO,
  atualizarPreferencias,
  fotoPerfil,
  lerPreferencias,
  nomeExibicao,
  restaurarPadroes
} from './preferencias.js'
import { buscarCidade } from './weather.js'
import { usuarioLogado } from '../services/api.js'
import { encerrarSessao } from '../services/conta.js'

/* Painel lateral direito: perfil, aparência, preferências e cartões da página inicial.
   Abre pelo avatar do canto superior direito e salva cada alteração na hora. */

function segmentado(nome, opcoes) {
  const botoes = opcoes
    .map((o) => `<button type="button" data-valor="${o.valor}" aria-pressed="false">${o.texto}</button>`)
    .join('')
  return `<div class="toggle-group" role="group" aria-label="${nome}" data-grupo="${nome}">${botoes}</div>`
}

function linhaSwitch(id, texto) {
  return `
    <label class="switch-row">
      <span>${texto}</span>
      <input class="switch" type="checkbox" role="switch" data-switch="${id}" />
    </label>`
}

function templateDrawer() {
  const cores = DESTAQUES.map(
    (d) => `
      <button class="swatch" type="button" data-destaque="${d.id}" style="--swatch:${d.cor}"
        aria-pressed="false" aria-label="${d.nome}" title="${d.nome}">${icon('check')}</button>`
  ).join('')

  const grupos = [...new Set(CARTOES.map((c) => c.grupo))]
    .map(
      (grupo) => `
      <div class="switch-group">
        <p class="switch-group-title">${grupo}</p>
        ${CARTOES.filter((c) => c.grupo === grupo)
          .map((c) => linhaSwitch(`cartao:${c.id}`, c.nome))
          .join('')}
      </div>`
    )
    .join('')

  return `
    <div class="drawer-scrim" id="drawer-scrim"></div>
    <aside class="drawer" id="profile-drawer" role="dialog" aria-modal="true"
      aria-labelledby="drawer-title" inert>
      <header class="drawer-head">
        <div>
          <p class="kicker">PERFIL E CONFIGURAÇÕES</p>
          <h2 id="drawer-title">Seu espaço</h2>
        </div>
        <button class="icon-btn" id="drawer-close" type="button" aria-label="Fechar painel">${icon('x')}</button>
      </header>

      <div class="drawer-body">
        <section class="drawer-section" aria-labelledby="sec-conta">
          <h3 id="sec-conta">Conta</h3>
          <p class="drawer-note" id="conta-email"></p>
          <button class="btn btn-sm" id="conta-sair" type="button">Sair da conta</button>
          <p class="drawer-note" id="conta-nota" role="status"></p>
        </section>

        <section class="drawer-section" aria-labelledby="sec-perfil">
          <h3 id="sec-perfil">Perfil</h3>
          <div class="profile-edit">
            <button class="profile-photo" id="profile-photo-btn" type="button" aria-label="Alterar foto de perfil"></button>
            <div class="profile-photo-actions">
              <button class="btn btn-sm" id="profile-photo-pick" type="button">${icon('camera')}Alterar foto</button>
              <button class="link-btn" id="profile-photo-remove" type="button">Remover foto</button>
            </div>
            <input id="profile-photo-input" type="file" accept="image/*" hidden />
          </div>
          <label class="field">
            Nome
            <input id="profile-name" type="text" maxlength="40" autocomplete="off" placeholder="${escaparHTML(perfil.nome)}" />
          </label>
          <p class="drawer-note" id="profile-note" role="status"></p>
        </section>

        <section class="drawer-section" aria-labelledby="sec-aparencia">
          <h3 id="sec-aparencia">Aparência</h3>
          <div class="field">
            Cor de destaque
            <div class="swatches" role="group" aria-label="Cor de destaque">${cores}</div>
          </div>
          <div class="field">
            Fundo
            ${segmentado('Fundo', [
              { valor: 'animado', texto: 'Animado' },
              { valor: 'estatico', texto: 'Estático' },
              { valor: 'desligado', texto: 'Sem efeito' }
            ])}
          </div>
          <div class="field">
            Densidade
            ${segmentado('Densidade', [
              { valor: 'confortavel', texto: 'Confortável' },
              { valor: 'compacta', texto: 'Compacta' }
            ])}
          </div>
        </section>

        <section class="drawer-section" aria-labelledby="sec-prefs">
          <h3 id="sec-prefs">Preferências</h3>
          <div class="field">
            Formato da hora
            ${segmentado('Hora', [
              { valor: '24', texto: '24 horas' },
              { valor: '12', texto: '12 horas' }
            ])}
          </div>
          <div class="field">
            Semana do calendário começa em
            ${segmentado('Semana', [
              { valor: '0', texto: 'Domingo' },
              { valor: '1', texto: 'Segunda' }
            ])}
          </div>
          ${linhaSwitch('clima:ativo', 'Mostrar clima na saudação')}
          <div class="field">
            Unidade de temperatura
            ${segmentado('Unidade', [
              { valor: 'C', texto: '°C' },
              { valor: 'F', texto: '°F' }
            ])}
          </div>
          <div class="field">
            Local do clima
            <div class="inline-field">
              <input id="weather-city" type="text" maxlength="60" autocomplete="off" placeholder="Buscar cidade" />
              <button class="btn btn-sm" id="weather-city-search" type="button">Buscar</button>
            </div>
            <p class="drawer-note" id="weather-city-note" role="status"></p>
            <button class="link-btn" id="weather-city-auto" type="button">${icon('map-pin')}Usar a localização do navegador</button>
          </div>
        </section>

        <section class="drawer-section" aria-labelledby="sec-cartoes">
          <h3 id="sec-cartoes">Página inicial</h3>
          <p class="drawer-note">Escolha o que aparece na página inicial.</p>
          ${grupos}
        </section>
      </div>

      <footer class="drawer-foot">
        <button class="btn btn-danger btn-sm" id="prefs-reset" type="button">Restaurar padrões</button>
      </footer>
    </aside>`
}

export function iniciarPerfil(app, { avisar }) {
  app.insertAdjacentHTML('beforeend', templateDrawer())

  const drawer = app.querySelector('#profile-drawer')
  const botaoAvatar = app.querySelector('#avatar-btn')
  const fechar = drawer.querySelector('#drawer-close')
  const scrim = app.querySelector('#drawer-scrim')

  const campoNome = drawer.querySelector('#profile-name')
  const fotoBotao = drawer.querySelector('#profile-photo-btn')
  const fotoInput = drawer.querySelector('#profile-photo-input')
  const fotoRemover = drawer.querySelector('#profile-photo-remove')
  const nota = drawer.querySelector('#profile-note')

  /* ---------- Conta ---------- */

  drawer.querySelector('#conta-email').textContent = usuarioLogado()?.email ?? ''
  drawer.querySelector('#conta-sair').addEventListener('click', async () => {
    const notaConta = drawer.querySelector('#conta-nota')
    try {
      await encerrarSessao()
    } catch {
      notaConta.textContent = 'Não foi possível sair agora. Tente novamente.'
    }
  })

  /* ---------- Avatar (canto superior e painel) ---------- */

  function avatarConteudo() {
    const foto = fotoPerfil()
    return foto
      ? `<img src="${escaparHTML(foto)}" alt="" />`
      : `<span>${escaparHTML(nomeExibicao().charAt(0).toUpperCase())}</span>`
  }

  function desenharAvatar() {
    botaoAvatar.querySelector('.avatar-face').innerHTML = avatarConteudo()
    fotoBotao.innerHTML = `${avatarConteudo()}<span class="profile-photo-edit">${icon('camera')}</span>`
    fotoRemover.hidden = !lerPreferencias().foto
  }

  /* ---------- Abrir e fechar ---------- */

  let aberto = false
  let anterior = null

  function definirAberto(valor) {
    if (valor === aberto) return
    aberto = valor
    app.classList.toggle('drawer-open', valor)
    drawer.inert = !valor
    botaoAvatar.setAttribute('aria-expanded', String(valor))

    if (valor) {
      anterior = document.activeElement
      sincronizar()
      // espera a transição começar para o foco não "pular" a animação
      requestAnimationFrame(() => fechar.focus({ preventScroll: true }))
    } else {
      anterior?.focus?.({ preventScroll: true })
    }
  }

  botaoAvatar.addEventListener('click', () => definirAberto(!aberto))
  fechar.addEventListener('click', () => definirAberto(false))
  scrim.addEventListener('click', () => definirAberto(false))

  document.addEventListener('keydown', (e) => {
    if (!aberto) return
    if (e.key === 'Escape' && !document.querySelector('dialog[open]')) {
      definirAberto(false)
      return
    }
    if (e.key !== 'Tab') return

    // Mantém o foco dentro do painel enquanto ele está aberto.
    const focaveis = [...drawer.querySelectorAll('button, input, select, a[href]')].filter(
      (el) => !el.disabled && !el.hidden && el.offsetParent !== null
    )
    if (!focaveis.length) return
    const primeiro = focaveis[0]
    const ultimo = focaveis[focaveis.length - 1]
    if (e.shiftKey && document.activeElement === primeiro) {
      e.preventDefault()
      ultimo.focus()
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault()
      primeiro.focus()
    }
  })

  /* ---------- Perfil: nome e foto ---------- */

  let temporizador
  const salvarNome = () => {
    clearTimeout(temporizador)
    if (!atualizarPreferencias({ nome: campoNome.value.trim() })) avisar('Não foi possível salvar o nome.')
  }
  campoNome.addEventListener('input', () => {
    clearTimeout(temporizador)
    temporizador = setTimeout(salvarNome, 300)
  })
  campoNome.addEventListener('blur', salvarNome)
  campoNome.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      salvarNome()
      avisar('Nome atualizado')
    }
  })

  const abrirSeletor = () => fotoInput.click()
  fotoBotao.addEventListener('click', abrirSeletor)
  drawer.querySelector('#profile-photo-pick').addEventListener('click', abrirSeletor)

  fotoInput.addEventListener('change', async () => {
    const arquivo = fotoInput.files?.[0]
    fotoInput.value = ''
    if (!arquivo) return

    try {
      const { blob } = await redimensionarImagem(arquivo, { largura: 256, altura: 256, modo: 'cobrir', qualidade: 0.88 })
      const dataUrl = await blobParaDataURL(blob)
      if (!atualizarPreferencias({ foto: dataUrl })) throw new Error('Não foi possível salvar a foto no navegador.')
      nota.textContent = ''
      avisar('Foto atualizada')
    } catch (erro) {
      nota.textContent = erro.message
    }
  })

  fotoRemover.addEventListener('click', () => {
    atualizarPreferencias({ foto: null })
    avisar('Foto removida')
  })

  /* ---------- Aparência e preferências ---------- */

  drawer.querySelectorAll('[data-destaque]').forEach((botao) =>
    botao.addEventListener('click', () => atualizarPreferencias({ destaque: botao.dataset.destaque }))
  )

  const aoEscolher = {
    Fundo: (v) => ({ fundo: v }),
    Densidade: (v) => ({ densidade: v }),
    Hora: (v) => ({ hora24: v === '24' }),
    Semana: (v) => ({ inicioSemana: Number(v) }),
    Unidade: (v) => ({ clima: { unidade: v } })
  }

  drawer.querySelectorAll('[data-grupo]').forEach((grupo) =>
    grupo.addEventListener('click', (e) => {
      const botao = e.target.closest('[data-valor]')
      if (botao) atualizarPreferencias(aoEscolher[grupo.dataset.grupo](botao.dataset.valor))
    })
  )

  drawer.querySelectorAll('[data-switch]').forEach((chave) =>
    chave.addEventListener('change', () => {
      const [tipo, id] = chave.dataset.switch.split(':')
      atualizarPreferencias(tipo === 'cartao' ? { cartoes: { [id]: chave.checked } } : { clima: { [id]: chave.checked } })
    })
  )

  /* ---------- Local do clima ---------- */

  const campoCidade = drawer.querySelector('#weather-city')
  const notaCidade = drawer.querySelector('#weather-city-note')
  const botaoBuscar = drawer.querySelector('#weather-city-search')

  async function procurarCidade() {
    const consulta = campoCidade.value.trim()
    if (consulta.length < 2) {
      notaCidade.textContent = 'Digite o nome da cidade.'
      return
    }
    botaoBuscar.disabled = true
    notaCidade.textContent = 'Buscando...'
    try {
      const cidade = await buscarCidade(consulta)
      if (!cidade) {
        notaCidade.textContent = 'Nenhuma cidade encontrada.'
        return
      }
      atualizarPreferencias({ clima: { cidade } })
      campoCidade.value = ''
      avisar('Local do clima atualizado')
    } catch {
      notaCidade.textContent = 'Não foi possível buscar agora. Tente novamente.'
    } finally {
      botaoBuscar.disabled = false
    }
  }

  botaoBuscar.addEventListener('click', procurarCidade)
  campoCidade.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      procurarCidade()
    }
  })
  const botaoAuto = drawer.querySelector('#weather-city-auto')
  botaoAuto.addEventListener('click', () => {
    atualizarPreferencias({ clima: { cidade: null } })
    avisar('Usando a localização do navegador')
  })

  drawer.querySelector('#prefs-reset').addEventListener('click', () => {
    if (!confirm('Restaurar nome, foto, aparência e preferências para o padrão?')) return
    restaurarPadroes()
    avisar('Padrões restaurados')
  })

  /* ---------- Estado visual ---------- */

  function sincronizar() {
    const p = lerPreferencias()

    if (document.activeElement !== campoNome) campoNome.value = p.nome

    const marcar = (grupo, valor) =>
      drawer.querySelectorAll(`[data-grupo="${grupo}"] [data-valor]`).forEach((b) =>
        b.setAttribute('aria-pressed', String(b.dataset.valor === String(valor)))
      )

    drawer.querySelectorAll('[data-destaque]').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.destaque === p.destaque))
    )
    marcar('Fundo', p.fundo)
    marcar('Densidade', p.densidade)
    marcar('Hora', p.hora24 ? '24' : '12')
    marcar('Semana', p.inicioSemana)
    marcar('Unidade', p.clima.unidade)

    drawer.querySelectorAll('[data-switch]').forEach((chave) => {
      const [tipo, id] = chave.dataset.switch.split(':')
      chave.checked = tipo === 'cartao' ? p.cartoes[id] !== false : Boolean(p.clima[id])
    })

    notaCidade.textContent = p.clima.cidade
      ? `Local atual: ${p.clima.cidade.nome}`
      : 'Usando a localização do navegador.'
    botaoAuto.hidden = !p.clima.cidade

    desenharAvatar()
  }

  window.addEventListener(EVENTO, sincronizar)
  sincronizar()

  return { abrir: () => definirAberto(true), fechar: () => definirAberto(false) }
}
