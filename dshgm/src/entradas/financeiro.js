import '../styles/main.css'
import '../styles/financeiro.css'
import { exigirLogin } from '../services/guarda.js'

await exigirLogin()
await import('../pages/financeiro.js')
