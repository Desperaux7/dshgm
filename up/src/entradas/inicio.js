import '../styles/main.css'
import '../styles/dashboard.css'
import { exigirLogin } from '../services/guarda.js'

const agora = new Date()
const mes = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`

await exigirLogin({ precarregar: ['/tarefas', '/favoritos', '/eventos', `/transacoes/resumo?mes=${mes}`] })
await import('../main.js')