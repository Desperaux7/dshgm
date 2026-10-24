import '../styles/main.css'
import '../styles/paginas.css'
import { exigirLogin } from '../services/guarda.js'

await exigirLogin({ precarregar: ['/eventos', '/calendario/status'] })
await import('../pages/agenda.js')