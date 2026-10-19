// Painel de conexão com o Google Calendar na página da Agenda.
// A sincronização NÃO é instantânea: acontece ao abrir a agenda, ao voltar para a aba, após cada alteração
// feita aqui e, no servidor, a cada 15 minutos.
import { calendarioApi, URL_CONECTAR, mudouAgenda } from '../services/calendarioApi.js'
import { mostrarAviso } from './shell.js'

const RETORNO_OAUTH = {
  conectado: 'Google Calendar conectado. Sincronizando...',
  cancelado: 'Conexão com o Google Calendar cancelada.',
  permissao_negada: 'Para sincronizar, é preciso permitir o acesso ao Google Calendar na tela do Google.',
  sem_credencial_offline: 'O Google não liberou o acesso contínuo. Tente conectar novamente.',
  falha: 'Não foi possível conectar ao Google Calendar. Tente novamente.',
  estado_invalido: 'A conexão expirou ou foi interrompida. Tente novamente.',
  sessao_expirada: 'A conexão expirou. Tente novamente.'
}

const formatarDataHora = (iso) =>
  iso
    ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
    : null

function el(tag, classe, texto) {
  const e = document.createElement(tag)
  if (classe) e.className = classe
  if (texto !== undefined) e.textContent = texto
  return e
}

function botao(texto, classe, aoClicar) {
  const b = el('button', `btn btn-sm ${classe}`.trim(), texto)
  b.type = 'button'
  b.addEventListener('click', aoClicar)
  return b
}

function linkConectar(texto) {
  const a = el('a', 'btn btn-sm btn-primary', texto)
  a.href = URL_CONECTAR
  return a
}

export function iniciarPainelGoogle({ aoSincronizar }) {
  const raiz = document.querySelector('#gcal-panel')
  if (!raiz) return

  let status = null
  let ocupado = false
  let mensagem = ''

  function render() {
    raiz.replaceChildren()
    const info = el('div', 'gcal-info')
    const acoes = el('div', 'gcal-actions')
    info.append(el('strong', '', 'Google Calendar'))

    if (!status) {
      info.append(el('p', '', mensagem || 'Verificando conexão...'))
    } else if (status.conectado) {
      info.append(el('p', '', `Conectado a ${status.email ?? 'sua conta Google'}.`))
      const ultima = formatarDataHora(status.ultimaSincronizacao)
      info.append(
        el(
          'p',
          '',
          `${ultima ? `Última sincronização: ${ultima}. ` : 'Ainda não sincronizado. '}A sincronização não é instantânea: ocorre ao abrir a agenda e a cada 15 minutos.`
        )
      )
      const { pending = 0, error = 0 } = status.eventosPorEstado ?? {}
      if (pending) info.append(el('p', 'gcal-aviso', `${pending} evento(s) aguardando envio ao Google.`))
      if (error) info.append(el('p', 'gcal-aviso', `${error} evento(s) com erro de sincronização.`))
      if (status.erro) info.append(el('p', 'gcal-aviso', status.erro))

      const sincronizar = botao(ocupado ? 'Sincronizando...' : 'Sincronizar agora', '', () => sincronizar_(true))
      sincronizar.disabled = ocupado
      acoes.append(sincronizar, botao('Desconectar', 'btn-danger', desconectar))
    } else if (status.estado === 'revoked' || status.estado === 'error') {
      info.append(el('p', 'gcal-aviso', status.erro || 'O acesso ao Google Calendar foi revogado ou expirou.'))
      info.append(el('p', '', 'Reconecte para voltar a sincronizar. Seus eventos continuam salvos aqui.'))
      acoes.append(linkConectar('Reconectar'), botao('Remover conexão', '', desconectar))
    } else {
      info.append(
        el('p', '', 'Veja na agenda os eventos do Google Calendar e envie para lá os que você criar aqui. É opcional.')
      )
      acoes.append(linkConectar('Conectar Google Calendar'))
    }

    if (mensagem && status) info.append(el('p', 'gcal-aviso', mensagem))
    raiz.append(info, acoes)
  }

  async function atualizarStatus() {
    try {
      status = await calendarioApi.status()
      mensagem = ''
    } catch (falha) {
      mensagem = `Não foi possível verificar a conexão (${falha.message}).`
    }
    render()
  }

  // forcar=true ignora o intervalo mínimo de 30 s do servidor.
  async function sincronizar_(forcar) {
    if (ocupado || !status?.conectado) return
    ocupado = true
    mensagem = ''
    render()
    try {
      const r = await calendarioApi.sincronizar(forcar)
      status = r.status ?? status
      if (r.estado === 'erro') mensagem = r.mensagem || 'A sincronização falhou. Tentaremos novamente.'
      else if (r.estado === 'em_andamento') mensagem = 'Já há uma sincronização em andamento.'
      if (mudouAgenda(r)) await aoSincronizar()
    } catch (falha) {
      mensagem = `Não foi possível sincronizar (${falha.message}).`
    }
    ocupado = false
    render()
  }

  async function desconectar() {
    const ok = confirm(
      'Desconectar o Google Calendar? Seus eventos continuam salvos aqui, mas deixam de ser sincronizados e o acesso concedido ao app é revogado.'
    )
    if (!ok) return
    try {
      await calendarioApi.desconectar()
      mostrarAviso('Google Calendar desconectado')
      await atualizarStatus()
      await aoSincronizar()
    } catch (falha) {
      mensagem = `Não foi possível desconectar (${falha.message}).`
      render()
    }
  }

  // Retorno do fluxo de autorização do Google (?calendario=...).
  async function tratarRetorno() {
    const url = new URL(window.location.href)
    const codigo = url.searchParams.get('calendario')
    if (!codigo) return false
    url.searchParams.delete('calendario')
    window.history.replaceState({}, '', url.pathname + url.search + url.hash)
    mostrarAviso(RETORNO_OAUTH[codigo] ?? RETORNO_OAUTH.falha)
    return codigo === 'conectado'
  }

  render()
  ;(async () => {
    const recemConectado = await tratarRetorno()
    await atualizarStatus()
    if (status?.conectado) await sincronizar_(recemConectado) // recém conectado: sincroniza já
  })()

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && status?.conectado) sincronizar_(false)
  })
}
