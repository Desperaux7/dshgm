// Gera valores aleatórios seguros para SESSION_SECRET e TOKEN_ENCRYPTION_KEY.
import { randomBytes } from 'node:crypto'

console.log(`SESSION_SECRET=${randomBytes(48).toString('base64url')}`)
console.log(`TOKEN_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`)
