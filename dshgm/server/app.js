import express, { Router } from 'express'
import helmet from 'helmet'
import { criarRepositorios } from './repositories/index.js'
import { criarClienteGoogle } from './services/google.js'
import { criarServicoCalendario } from './services/calendarSync.js'
import { carregarSessao, exigirAutenticacao, protegerCsrf, verificarOrigem } from './middleware/sessao.js'
import { naoEncontradaRota, tratarErros } from './middleware/erros.js'
import { criarLimitadores } from './middleware/limites.js'
import { criarRotasAuth } from './routes/auth.js'
import { criarRotasCalendario } from './routes/calendario.js'
import { criarRotasPerfil } from './routes/perfil.js'
import { criarRotasTarefas } from './routes/tarefas.js'
import { criarRotasMeta, criarRotasTransacoes } from './routes/transacoes.js'
import { criarRotasFavoritos } from './routes/favoritos.js'
import { criarRotasLazer } from './routes/lazer.js'
import { criarRotasEventos } from './routes/eventos.js'
import { criarRotasImportacao } from './routes/importacao.js'

// Fábrica do app: banco, config e cliente Google são injetados (produção usa Neon; testes usam PGlite e Google simulado).
export function criarApp({ config, db, fetchImpl, limitar = true, atrasosRede }) {
  const repos = criarRepositorios(db)
  const google = criarClienteGoogle({ config, fetchImpl, atrasos: atrasosRede })
  const calendario = criarServicoCalendario({ repos, google, config })
  const limites = criarLimitadores({ habilitado: limitar })

  const api = Router()
  api.use(limites.geral)
  api.use(verificarOrigem(config))
  api.use(express.json({ limit: '2mb' }))
  api.use(carregarSessao({ config, repos }))

  // Públicas (a própria rota verifica sessão quando precisa)
  api.get('/saude', (_req, res) => res.json({ ok: true }))
  api.use('/auth', criarRotasAuth({ config, repos, google, limites }))
  const cal = criarRotasCalendario({ config, repos, google, calendario, limites })
  api.use('/calendario', cal.publico)

  // Tudo abaixo exige sessão válida e, nas escritas, token CSRF.
  const privado = Router()
  privado.use(exigirAutenticacao, protegerCsrf)
  privado.use('/calendario', cal.protegido)
  privado.use('/', criarRotasPerfil({ repos }))
  privado.use('/tarefas', criarRotasTarefas({ repos }))
  privado.use('/transacoes', criarRotasTransacoes({ repos }))
  privado.use('/meta', criarRotasMeta({ repos }))
  privado.use('/favoritos', criarRotasFavoritos({ repos }))
  privado.use('/lazer', criarRotasLazer({ repos }))
  privado.use('/eventos', criarRotasEventos({ repos, calendario }))
  privado.use('/importacao', criarRotasImportacao({ repos, calendario, limites }))
  api.use(privado)

  const app = express()
  app.disable('x-powered-by')
  app.use(helmet())
  // No Netlify a função recebe o caminho reescrito; aceitamos os dois prefixos.
  app.use(['/api', '/.netlify/functions/api'], api)
  app.use(naoEncontradaRota)
  app.use(tratarErros)

  return { app, repos, google, calendario }
}
