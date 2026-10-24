import '../styles/main.css'
import '../styles/paginas.css'
import { exigirLogin } from '../services/guarda.js'

await exigirLogin({ precarregar: ['/favoritos'] })
await import('../pages/favoritos.js')