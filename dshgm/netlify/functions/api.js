import serverless from 'serverless-http'
import { obterServidor } from '../../server/index.js'

let handlerCache
export const handler = async (event, context) => {
  handlerCache ??= serverless(obterServidor().app, { binary: ['image/*'] })
  return handlerCache(event, context)
}
