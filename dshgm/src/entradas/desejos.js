import '../styles/main.css'
import '../styles/paginas.css'
import '../styles/desejos.css'
import { exigirLogin } from '../services/guarda.js'

await exigirLogin({ precarregar: ['/desejos'] })
await import('../pages/desejos.js')
