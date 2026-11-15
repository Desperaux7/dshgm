// Regras puras dos modos de uso (Pessoal e Profissional): quais módulos existem em cada um.
// Sem acesso ao navegador, para poder ser testado. A tela usa isto no menu lateral e na página inicial.

export const MODOS = [
  { id: 'pessoal', nome: 'Pessoal' },
  { id: 'profissional', nome: 'Profissional' }
]
export const MODO_PADRAO = 'pessoal'
const AMBOS = ['pessoal', 'profissional']

// Menu lateral: cada item existe em um ou nos dois modos.
export const LINKS = [
  { id: 'inicio', href: 'index.html', icone: 'home', texto: 'Início', modos: AMBOS },
  { id: 'tarefas', href: 'index.html#tarefas', icone: 'tasks', texto: 'Tarefas', modos: AMBOS },
  { id: 'agenda', href: 'agenda.html', icone: 'calendar', texto: 'Agenda', modos: AMBOS },
  { id: 'favoritos', href: 'favoritos.html', icone: 'bookmark', texto: 'Favoritos', modos: ['pessoal'] },
  { id: 'lazer', href: 'lazer.html', icone: 'gamepad', texto: 'Lazer', modos: ['pessoal'] },
  { id: 'desejos', href: 'desejos.html', icone: 'gift', texto: 'Lista de Desejos', modos: ['pessoal'] },
  { id: 'times', href: 'times.html', icone: 'users', texto: 'Times', modos: ['profissional'] },
  { id: 'financeiro', href: 'financeiro.html', icone: 'dollar', texto: 'Financeiro', modos: AMBOS },
  { id: 'spotify', href: 'index.html#spotify', icone: 'spotify', texto: 'Spotify', modos: ['pessoal'] }
]

export const linksDoModo = (modo) => LINKS.filter((l) => l.modos.includes(modo))

// Cartões da página inicial que podem ser exibidos ou ocultados. Cada modo guarda a sua própria escolha.
export const CARTOES = [
  { id: 'resumo-tarefas', grupo: 'Indicadores', nome: 'Tarefas pendentes', modos: AMBOS },
  { id: 'resumo-agenda', grupo: 'Indicadores', nome: 'Próximo compromisso', modos: AMBOS },
  { id: 'resumo-saldo', grupo: 'Indicadores', nome: 'Saldo do mês', modos: AMBOS },
  { id: 'resumo-times', grupo: 'Indicadores', nome: 'Times e colaboradores', modos: ['profissional'] },
  { id: 'painel-agenda', grupo: 'Painéis', nome: 'Agenda', modos: AMBOS },
  { id: 'painel-tarefas', grupo: 'Painéis', nome: 'Tarefas do dia', modos: AMBOS },
  { id: 'painel-times', grupo: 'Painéis', nome: 'Times', modos: ['profissional'] },
  { id: 'painel-spotify', grupo: 'Painéis', nome: 'Spotify', modos: ['pessoal'] },
  { id: 'atalhos', grupo: 'Início', nome: 'Atalhos de favoritos', modos: ['pessoal'] }
]

export const cartoesDoModo = (modo) => CARTOES.filter((c) => c.modos.includes(modo))
// Chave das preferências onde cada modo guarda a escolha de cartões.
export const chaveCartoes = (modo) => (modo === 'profissional' ? 'cartoesPro' : 'cartoes')
export const padraoCartoes = (modo) => Object.fromEntries(cartoesDoModo(modo).map((c) => [c.id, true]))

// Um cartão aparece se existe no modo da preferência e não foi desligado pelo usuário nesse modo.
export function cartaoVisivel(id, prefs) {
  const cartao = CARTOES.find((c) => c.id === id)
  if (!cartao) return true // elemento marcado que não está no catálogo: não esconde
  const modo = MODOS.some((m) => m.id === prefs.modo) ? prefs.modo : MODO_PADRAO
  if (!cartao.modos.includes(modo)) return false
  return (prefs[chaveCartoes(modo)] ?? {})[id] !== false
}
