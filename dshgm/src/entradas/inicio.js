import { exigirLogin } from '../services/guarda.js'

await exigirLogin()
await import('../main.js')
