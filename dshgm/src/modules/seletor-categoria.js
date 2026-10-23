import { icon } from './icons.js'

/*
  Menu suspenso de categorias (substitui a lista nativa do <select>, que o navegador desenha como quiser).

  O <select> original continua no documento, escondido, como fonte do valor: o restante da tela segue lendo
  `select.value` e as opções continuam sendo preenchidas por quem usa o componente. Depois de mudar as opções,
  chame `atualizar()`.

  Opções:
    select        <select> que guarda o valor
    iconeDe(nome) nome do ícone da categoria
    corDe(nome)   cor (hex) da bolinha/ícone da categoria
    podeRemover(nome)   true para categorias criadas pelo usuário (mostram o botão de remover)
    aoCriar(nome)       async; cria a categoria e devolve o nome final (lança Error com a mensagem a exibir)
    aoRemover(nome)     async; remove a categoria (lança Error com a mensagem a exibir)
*/

let contador = 0

export function criarSeletorCategoria({ select, iconeDe, corDe, podeRemover, aoCriar, aoRemover }) {
  const id = `cat-select-${++contador}`

  const raiz = document.createElement('div')
  raiz.className = 'cat-select'
  raiz.innerHTML = `
    <button class="cat-trigger" type="button" role="combobox" aria-haspopup="listbox"
            aria-expanded="false" aria-controls="${id}-lista">
      <span class="cat-chip" aria-hidden="true"></span>
      <span class="cat-current"></span>
      ${icon('chevron-down', 'cat-caret')}
    </button>
    <div class="cat-menu" hidden>
      <ul class="cat-list" id="${id}-lista" role="listbox" tabindex="-1"></ul>
      <div class="cat-footer">
        <button class="cat-new-btn" type="button">${icon('plus')}<span>Nova categoria</span></button>
        <div class="cat-new-form" hidden>
          <div class="cat-new-row">
            <input class="cat-new-input" type="text" maxlength="40" autocomplete="off"
                   placeholder="Nome da categoria" aria-label="Nome da nova categoria">
            <button class="cat-new-save" type="button">Criar</button>
            <button class="cat-new-cancel" type="button" aria-label="Cancelar">${icon('x')}</button>
          </div>
          <p class="cat-new-error" role="alert"></p>
        </div>
      </div>
    </div>`

  select.hidden = true
  select.tabIndex = -1
  select.setAttribute('aria-hidden', 'true')
  select.after(raiz)

  const gatilho = raiz.querySelector('.cat-trigger')
  const chipAtual = raiz.querySelector('.cat-trigger .cat-chip')
  const textoAtual = raiz.querySelector('.cat-current')
  const menu = raiz.querySelector('.cat-menu')
  const lista = raiz.querySelector('.cat-list')
  const botaoNova = raiz.querySelector('.cat-new-btn')
  const formNova = raiz.querySelector('.cat-new-form')
  const campoNova = raiz.querySelector('.cat-new-input')
  const erroNova = raiz.querySelector('.cat-new-error')
  const salvarNova = raiz.querySelector('.cat-new-save')

  let ativo = -1 // índice da opção destacada pelo teclado

  const opcoes = () => [...lista.querySelectorAll('[role="option"]')]

  function preencherChip(elemento, nome) {
    elemento.style.setProperty('--cat-cor', corDe(nome))
    elemento.innerHTML = icon(iconeDe(nome))
  }

  function sincronizarGatilho() {
    const valor = select.value
    textoAtual.textContent = valor || 'Escolha uma categoria'
    textoAtual.classList.toggle('is-placeholder', !valor)
    if (valor) preencherChip(chipAtual, valor)
    else chipAtual.replaceChildren()
    chipAtual.hidden = !valor
  }

  function desenharLista() {
    lista.replaceChildren()
    ;[...select.options].forEach((opcao, indice) => {
      const nome = opcao.value
      const selecionada = nome === select.value

      const item = document.createElement('li')
      item.className = 'cat-option'
      item.id = `${id}-op-${indice}`
      item.setAttribute('role', 'option')
      item.setAttribute('aria-selected', String(selecionada))
      item.dataset.valor = nome

      const chip = document.createElement('span')
      chip.className = 'cat-chip'
      chip.setAttribute('aria-hidden', 'true')
      preencherChip(chip, nome)

      const rotulo = document.createElement('span')
      rotulo.className = 'cat-label'
      rotulo.textContent = nome

      item.append(chip, rotulo)

      if (podeRemover?.(nome)) {
        const remover = document.createElement('button')
        remover.type = 'button'
        remover.className = 'cat-remove'
        remover.innerHTML = icon('trash')
        remover.title = 'Remover categoria'
        remover.setAttribute('aria-label', `Remover a categoria ${nome}`)
        remover.addEventListener('click', (e) => {
          e.stopPropagation()
          removerCategoria(nome, remover)
        })
        item.append(remover)
      }

      const marca = document.createElement('span')
      marca.className = 'cat-check'
      marca.setAttribute('aria-hidden', 'true')
      marca.innerHTML = selecionada ? icon('check') : ''
      item.append(marca)

      item.addEventListener('click', () => escolher(nome))
      item.addEventListener('mousemove', () => destacar(indice, { rolar: false }))
      lista.append(item)
    })
  }

  function destacar(indice, { rolar = true } = {}) {
    const itens = opcoes()
    if (!itens.length) return
    ativo = Math.max(0, Math.min(indice, itens.length - 1))
    itens.forEach((el, i) => el.classList.toggle('is-active', i === ativo))
    gatilho.setAttribute('aria-activedescendant', itens[ativo].id)
    if (rolar) itens[ativo].scrollIntoView({ block: 'nearest' })
  }

  function aberto() {
    return !menu.hidden
  }

  function abrir() {
    if (aberto()) return
    desenharLista()
    menu.hidden = false
    gatilho.setAttribute('aria-expanded', 'true')
    raiz.classList.add('is-open')

    // Abre para cima quando não há espaço embaixo.
    const caixa = gatilho.getBoundingClientRect()
    const espacoAbaixo = window.innerHeight - caixa.bottom
    raiz.classList.toggle('opens-up', espacoAbaixo < 320 && caixa.top > espacoAbaixo)

    const indiceAtual = [...select.options].findIndex((o) => o.value === select.value)
    destacar(indiceAtual >= 0 ? indiceAtual : 0)
  }

  function fechar({ devolverFoco = false } = {}) {
    if (!aberto()) return
    menu.hidden = true
    gatilho.setAttribute('aria-expanded', 'false')
    gatilho.removeAttribute('aria-activedescendant')
    raiz.classList.remove('is-open', 'opens-up')
    cancelarNova()
    if (devolverFoco) gatilho.focus()
  }

  function escolher(nome) {
    const mudou = select.value !== nome
    select.value = nome
    sincronizarGatilho()
    fechar({ devolverFoco: true })
    if (mudou) select.dispatchEvent(new Event('change', { bubbles: true }))
  }

  /* ---------- Nova categoria ---------- */

  function abrirNova() {
    botaoNova.hidden = true
    formNova.hidden = false
    erroNova.textContent = ''
    campoNova.value = ''
    campoNova.focus()
  }

  function cancelarNova() {
    formNova.hidden = true
    botaoNova.hidden = false
    erroNova.textContent = ''
    campoNova.value = ''
  }

  async function criarNova() {
    const nome = campoNova.value.trim().replace(/\s+/g, ' ')
    if (!nome) {
      erroNova.textContent = 'Informe o nome da categoria.'
      campoNova.focus()
      return
    }

    salvarNova.disabled = true
    campoNova.disabled = true
    try {
      const final = await aoCriar(nome)
      atualizar()
      escolher(final ?? nome)
    } catch (erro) {
      erroNova.textContent = erro?.message || 'Não foi possível criar a categoria.'
    } finally {
      salvarNova.disabled = false
      campoNova.disabled = false
    }
    if (aberto() && !formNova.hidden) campoNova.focus()
  }

  async function removerCategoria(nome, botao) {
    if (!confirm(`Remover a categoria "${nome}"? As movimentações já registradas continuam com esse nome.`)) return
    botao.disabled = true
    try {
      await aoRemover(nome)
      atualizar()
      if (aberto()) {
        desenharLista()
        destacar(Math.min(ativo, select.options.length - 1))
      }
    } catch (erro) {
      botao.disabled = false
      erroNova.textContent = ''
      alert(erro?.message || 'Não foi possível remover a categoria.')
    }
  }

  botaoNova.addEventListener('click', abrirNova)
  raiz.querySelector('.cat-new-cancel').addEventListener('click', () => {
    cancelarNova()
    gatilho.focus()
  })
  salvarNova.addEventListener('click', criarNova)
  campoNova.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault() // não envia o formulário de movimentação
      criarNova()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      cancelarNova()
      gatilho.focus()
    }
  })

  /* ---------- Interação com o gatilho ---------- */

  gatilho.addEventListener('click', () => (aberto() ? fechar() : abrir()))

  gatilho.addEventListener('keydown', (e) => {
    const total = select.options.length
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (!aberto()) abrir()
        else destacar(ativo + 1)
        break
      case 'ArrowUp':
        e.preventDefault()
        if (!aberto()) abrir()
        else destacar(ativo - 1)
        break
      case 'Home':
        if (aberto()) {
          e.preventDefault()
          destacar(0)
        }
        break
      case 'End':
        if (aberto()) {
          e.preventDefault()
          destacar(total - 1)
        }
        break
      case 'Enter':
      case ' ':
        if (aberto() && ativo >= 0) {
          e.preventDefault()
          escolher(select.options[ativo].value)
        }
        break
      case 'Escape':
        if (aberto()) {
          e.preventDefault()
          e.stopPropagation()
          fechar({ devolverFoco: true })
        }
        break
      case 'Tab':
        fechar()
        break
    }
  })

  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      fechar({ devolverFoco: true })
    }
  })

  document.addEventListener('pointerdown', (e) => {
    if (aberto() && !raiz.contains(e.target)) fechar()
  })

  // Quem mudar `select.value` por código pode chamar atualizar() para refletir aqui.
  select.addEventListener('change', sincronizarGatilho)

  function atualizar() {
    sincronizarGatilho()
    if (aberto()) {
      desenharLista()
      destacar(ativo)
    }
  }

  atualizar()
  return { atualizar, fechar }
}
