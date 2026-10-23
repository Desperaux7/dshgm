import '../styles/main.css'
import '../styles/financeiro.css'
import { exigirLogin } from '../services/guarda.js'

await exigirLogin({ precarregar: ['/transacoes?limite=2000&offset=0', '/meta', '/categorias'] })
await import('../pages/financeiro.js')
