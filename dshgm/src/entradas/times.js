import '../styles/main.css'
import '../styles/paginas.css'
import '../styles/times.css'
import { exigirLogin } from '../services/guarda.js'

await exigirLogin({ precarregar: ['/times'] })
await import('../pages/times.js')
