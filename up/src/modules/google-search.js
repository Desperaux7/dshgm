// Pesquisa Google: começa como um botão com a lupa e expande ao clicar.
// Atalho: "/" abre e foca a barra de qualquer lugar da página.
export function iniciarPesquisaGoogle() {
  const form = document.querySelector('#google-search')
  const toggle = document.querySelector('#google-search-toggle')
  const input = document.querySelector('#google-search-input')

  if (!form || !toggle || !input) {
    console.warn('Elementos da pesquisa Google não encontrados.')
    return
  }

  function definirAberta(aberta) {
    form.classList.toggle('is-expanded', aberta)
    toggle.setAttribute('aria-expanded', String(aberta))
    toggle.setAttribute('aria-label', aberta ? 'Pesquisar no Google' : 'Abrir pesquisa do Google')
    input.tabIndex = aberta ? 0 : -1

    if (aberta) {
      input.focus()
    } else {
      input.value = ''
      input.blur()
    }
  }

  const estaAberta = () => form.classList.contains('is-expanded')

  toggle.addEventListener('click', () => {
    if (!estaAberta()) {
      definirAberta(true)
    } else if (input.value.trim()) {
      form.requestSubmit()
    } else {
      definirAberta(false)
    }
  })

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') definirAberta(false)
  })

  // Clique fora recolhe a barra quando ela está vazia.
  document.addEventListener('click', (event) => {
    if (estaAberta() && !input.value.trim() && !form.contains(event.target)) {
      definirAberta(false)
    }
  })

  document.addEventListener('keydown', (event) => {
    const alvo = event.target
    const digitando =
      alvo instanceof HTMLElement &&
      (alvo.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(alvo.tagName))

    if (event.key === '/' && !digitando && !event.ctrlKey && !event.metaKey) {
      event.preventDefault()
      definirAberta(true)
    }
  })

  form.addEventListener('submit', (event) => {
    const consulta = input.value.trim()

    if (!consulta) {
      event.preventDefault()
      input.focus()
      return
    }

    input.value = consulta
  })
}
