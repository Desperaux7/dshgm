import '../styles/main.css'
import '../styles/dashboard.css'
import { exigirLogin } from '../services/guarda.js'

await exigirLogin()
await import('../main.js')