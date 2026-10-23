// Porta de entrada das páginas: exige login Google antes de carregar qualquer módulo do dashboard.
// Também prepara a conta (importa preferências antigas do navegador e baixa as da conta) e trata sessão expirada.
import { EVENTO_SESSAO_EXPIRADA, api, carregarSessao, entrarComGoogle, precarregar } from './api.js'

const ESTILO = `
.guarda{position:fixed;inset:0;z-index:99999;display:grid;place-items:center;padding:24px;
  background:radial-gradient(900px 500px at 20% 10%,rgba(94,234,212,.10),transparent 60%),
             radial-gradient(800px 500px at 90% 90%,rgba(56,189,248,.08),transparent 60%),#040a0b;
  color:#e6f4f2;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
.guarda-card{width:min(420px,100%);padding:36px 32px;border-radius:20px;text-align:center;
  background:rgba(10,24,27,.72);border:1px solid rgba(120,220,210,.24);backdrop-filter:blur(14px)}
.guarda-kicker{margin:0 0 8px;font-size:.72rem;letter-spacing:.28em;color:#5eead4}
.guarda h1{margin:0 0 12px;font-size:1.5rem;font-weight:600}
.guarda-texto{margin:0 0 24px;color:#86a3a3;line-height:1.5;font-size:.95rem}
.guarda-botao{display:inline-flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:12px 16px;
  border-radius:12px;border:1px solid rgba(120,220,210,.3);background:#e6f4f2;color:#0b1d1f;
  font:inherit;font-weight:600;cursor:pointer;transition:transform .15s,box-shadow .15s}
.guarda-botao:hover{transform:translateY(-1px);box-shadow:0 8px 24px rgba(94,234,212,.18)}
.guarda-botao:focus-visible{outline:2px solid #5eead4;outline-offset:3px}
.guarda-botao[disabled]{opacity:.6;cursor:progress;transform:none}
.guarda-aviso{margin:16px 0 0;min-height:1.2em;font-size:.88rem;color:#fbbf24}
.guarda-nota{margin:20px 0 0;font-size:.78rem;color:#5d7b7b}
.dshgm-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:99998;max-width:min(520px,92vw);
  padding:12px 18px;border-radius:12px;background:rgba(12,28,32,.94);color:#e6f4f2;font:.9rem system-ui,sans-serif;
  border:1px solid rgba(120,220,210,.3);box-shadow:0 10px 30px rgba(0,0,0,.4)}
.dshgm-toast[data-tipo='aviso']{border-color:rgba(251,191,36,.5)}
`

const MENSAGENS_ERRO = {
  cancelado: 'Login cancelado. Quando quiser, é só tentar de novo.',
  estado_invalido: 'A tentativa de login expirou ou foi interrompida. Tente novamente.',
  sessao_expirada: 'A tentativa de login expirou. Tente novamente.',
  nao_autorizado: 'Esta conta Google não tem acesso a este dashboard. Entre com a conta autorizada.',
  falha: 'Não foi possível entrar com o Google. Tente novamente.'
}

const GOOGLE_G = `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.3 0 11.7-2.1 15.6-5.7l-7.4-5.7c-2.1 1.4-4.8 2.3-8.2 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>`

function garantirEstilo() {
  if (document.getElementById('guarda-estilo')) return
  const estilo = document.createElement('style')
  estilo.id = 'guarda-estilo'
  estilo.textContent = ESTILO
  document.head.append(estilo)
}

function destinoDeRetorno() {
  // O retorno do Spotify (/callback) não pode ser reaproveitado: o código de autorização se perde no login.
  const caminho = window.location.pathname
  return caminho === '/callback' ? '/' : caminho
}

/* ---------- Avisos curtos ---------- */

export function avisar(texto, tipo = 'info', ms = 7000) {
  garantirEstilo()
  const el = document.createElement('div')
  el.className = 'dshgm-toast'
  el.dataset.tipo = tipo
  el.setAttribute('role', 'status')
  el.textContent = texto
  document.body.append(el)
  setTimeout(() => el.remove(), ms)
}

/* ---------- Tela de login ---------- */

let telaAberta = false

function montarTela({ texto, aviso, botao = 'Entrar com Google', icone = GOOGLE_G, aoClicar }) {
  garantirEstilo()
  document.querySelector('.guarda')?.remove()
  const tela = document.createElement('div')
  tela.className = 'guarda'
  tela.setAttribute('role', 'dialog')
  tela.setAttribute('aria-modal', 'true')
  tela.setAttribute('aria-labelledby', 'guarda-titulo')
  tela.innerHTML = `
    <div class="guarda-card">
      <p class="guarda-kicker">DSHGM</p>
      <h1 id="guarda-titulo">Dashboard Pessoal</h1>
      <p class="guarda-texto"></p>
      <button class="guarda-botao" type="button">${icone}<span></span></button>
      <p class="guarda-aviso" role="alert"></p>
    </div>`
  tela.querySelector('.guarda-texto').textContent = texto
  tela.querySelector('.guarda-botao span').textContent = botao
  tela.querySelector('.guarda-aviso').textContent = aviso ?? ''
  const b = tela.querySelector('.guarda-botao')
  b.addEventListener('click', () => {
    b.disabled = true
    aoClicar()
  })
  document.body.append(tela)
  b.focus()
}

function telaLogin(aviso) {
  telaAberta = true
  montarTela({
    texto: 'Entre com sua conta Google para acessar seus dados em qualquer dispositivo.',
    aviso,
    aoClicar: () => entrarComGoogle(destinoDeRetorno())
  })
}

// Falha ao falar com o servidor: oferece nova tentativa (a página só segue quando houver resposta).
function telaErroServidor(erro) {
  return new Promise((resolver) => {
    const aviso =
      erro.status === 0
        ? 'Sem conexão com o servidor.'
        : 'O servidor não respondeu como esperado. Em desenvolvimento, confirme que "npm run dev:api" está rodando.'
    montarTela({
      texto: 'Não foi possível verificar sua sessão.',
      aviso,
      botao: 'Tentar novamente',
      icone: '',
      aoClicar: () => {
        document.querySelector('.guarda')?.remove()
        resolver()
      }
    })
  })
}

function lerErroDeLogin() {
  const url = new URL(window.location.href)
  const codigo = url.searchParams.get('erro_login')
  if (!codigo) return null
  url.searchParams.delete('erro_login')
  window.history.replaceState({}, '', url.pathname + url.search + url.hash)
  return MENSAGENS_ERRO[codigo] ?? MENSAGENS_ERRO.falha
}

/* ---------- Preparo da conta ---------- */

function relatarMigracao(relatorio) {
  for (const item of relatorio) {
    const backup = item.backup ? ` Uma cópia dos dados originais ficou guardada neste navegador (${item.backup}).` : ''
    if (item.status === 'ok') {
      if (item.detalhe === 'importadas') avisar(`${item.rotulo} deste navegador foram importadas para a sua conta.`)
      else if (item.detalhe === 'importada') avisar(`${item.rotulo} deste navegador foi importada para a sua conta.`)
      else if (item.importados > 0) {
        const jaTinha = item.jaExistiam ? ` (${item.jaExistiam} já estavam na conta)` : ''
        avisar(`${item.rotulo}: ${item.importados} registro(s) importado(s) para a sua conta${jaTinha}.`)
      }
    } else if (item.status === 'parcial') {
      const rej = item.rejeitados?.length ? ` ${item.rejeitados.length} registro(s) inválido(s) não foram importados.` : ''
      avisar(`${item.rotulo}: importação parcial.${rej}${item.detalhe ?? ''}${backup}`, 'aviso', 12000)
    } else if (item.status === 'erro') {
      avisar(`${item.rotulo}: não foi possível importar. Seus dados locais foram mantidos.`, 'aviso')
    } else if (item.status === 'incompleta') {
      avisar(`${item.rotulo}: ${item.detalhe}`, 'aviso', 12000)
    }
    if (item.extra?.enviadas) avisar(`${item.extra.enviadas} capa(s) enviada(s) para a sua conta.`)
  }
}

// Capas antigas do IndexedDB. Imagens acima do limite do servidor (600 KB) são reduzidas antes do envio.
// O módulo de imagens só é carregado se houver capa para enviar (não atrasa quem não tem nada a migrar).
function capasDoNavegador() {
  let modulo
  const carregar = () => (modulo ??= import('./imagens.js'))
  const LIMITE = 550 * 1024
  return {
    async ler(id) {
      const imagens = await carregar()
      const lido = await imagens.lerCapa(id)
      if (!lido) return null
      const blob = lido.type ? lido : new Blob([lido], { type: 'image/jpeg' })
      if (blob.size <= LIMITE) return { blob }
      const reduzida = await imagens.redimensionarImagem(blob, { largura: 700, altura: 700, modo: 'conter', qualidade: 0.7 })
      return { blob: reduzida.blob, largura: reduzida.largura, altura: reduzida.altura }
    },
    excluir: async (id) => (await carregar()).excluirCapa(id)
  }
}

async function prepararConta(usuario) {
  const cache = await import('./cacheLocal.js')

  // Cache de outra conta neste navegador nunca é copiado para esta. Precisa acontecer ANTES de importar
  // o módulo de preferências, que lê o cache ao ser carregado.
  const dono = cache.donoDoCache()
  if (dono && dono !== usuario.id) cache.limparCache()
  const cacheDestaConta = cache.donoDoCache() === usuario.id

  const [preferencias, migracao] = await Promise.all([import('../modules/preferencias.js'), import('./migracao.js')])
  preferencias.definirUsuarioExterno({ nome: usuario.nome, foto: usuario.foto })

  const { relatorio } = await migracao.migrar({
    api,
    armazenamento: localStorage,
    userId: usuario.id,
    capas: capasDoNavegador()
  })
  cache.definirDonoDoCache(usuario.id)
  relatarMigracao(relatorio)

  // Neste navegador já há preferências desta conta em cache: a página abre na hora com elas e a versão do
  // servidor entra em segundo plano (o evento de preferências atualiza nome, avatar e cartões sem recarregar).
  // Sem cache (primeiro acesso aqui), espera a resposta para não mostrar valores padrão que depois mudam.
  const sincronizacao = preferencias.sincronizarComServidor()
  if (cacheDestaConta) {
    sincronizacao.catch((erro) => console.warn('Preferências não sincronizadas agora:', erro.message))
    return
  }
  await sincronizacao
}

function vigiarSessao() {
  window.addEventListener(EVENTO_SESSAO_EXPIRADA, () => {
    if (telaAberta) return
    telaLogin('Sua sessão expirou. Entre novamente para continuar.')
  })
}

/* ---------- API pública ---------- */

// `precarregar`: caminhos GET da API que a página vai pedir logo em seguida. Eles saem já na confirmação da
// sessão, em paralelo com a preparação da conta e o download dos módulos da página.
export async function exigirLogin({ precarregar: caminhos = [] } = {}) {
  const erroDeLogin = lerErroDeLogin()
  let usuario
  for (;;) {
    try {
      usuario = await carregarSessao()
      break
    } catch (erro) {
      await telaErroServidor(erro)
    }
  }

  if (!usuario) {
    telaLogin(erroDeLogin)
    return new Promise(() => {}) // a página só carrega depois do login (o navegador sai daqui para o Google)
  }

  precarregar(['/preferencias', ...caminhos])

  try {
    await prepararConta(usuario)
  } catch (erro) {
    console.error('Falha ao preparar a conta:', erro)
    avisar('Não foi possível sincronizar suas preferências agora. O dashboard continua funcionando.', 'aviso')
  }
  vigiarSessao()
  return usuario
}
