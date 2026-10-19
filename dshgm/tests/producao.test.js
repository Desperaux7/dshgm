import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const raiz = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url))
const ler = (p) => readFile(raiz(p), 'utf8')

describe('compatibilidade com o Netlify', () => {
  it('netlify.toml: build do Vite, funções e redirecionamentos', async () => {
    const toml = await ler('netlify.toml')
    expect(toml).toMatch(/command\s*=\s*"npm run build"/)
    expect(toml).toMatch(/publish\s*=\s*"dist"/)
    expect(toml).toMatch(/functions\s*=\s*"netlify\/functions"/)
    expect(toml).toMatch(/from\s*=\s*"\/api\/\*"[\s\S]*?to\s*=\s*"\/\.netlify\/functions\/api\/:splat"[\s\S]*?status\s*=\s*200/)
    expect(toml).toMatch(/from\s*=\s*"\/callback"[\s\S]*?to\s*=\s*"\/index\.html"/) // retorno OAuth do Spotify
  })

  it('a função serverless exporta um handler e o agendador declara a programação', async () => {
    const api = await ler('netlify/functions/api.js')
    expect(api).toMatch(/export const handler/)
    expect(api).toMatch(/serverless-http/)
    const agendador = await ler('netlify/functions/calendar-sync.js')
    expect(agendador).toMatch(/schedule:\s*'\*\/15 \* \* \* \*'/)
  })

  it('o servidor usa o driver HTTP do Neon (sem pool persistente) e nenhum arquivo local', async () => {
    const neon = await ler('server/db/neon.js')
    expect(neon).toMatch(/neon\(connectionString\)/)
    expect(neon).not.toMatch(/new Pool|writeFile|createWriteStream/)
  })

  it('.env.example documenta todas as variáveis lidas pela configuração', async () => {
    const exemplo = await ler('.env.example')
    const config = await ler('server/config.js')
    const usadas = [...config.matchAll(/env\.([A-Z_]+)/g)].map((m) => m[1])
    for (const v of new Set(usadas)) expect(exemplo, v).toMatch(new RegExp(`^${v}=`, 'm'))
    expect(exemplo).not.toMatch(/GOCSPX-/)
  })

  it('.gitignore protege segredos e dependências', async () => {
    const gi = await ler('.gitignore')
    for (const item of ['node_modules/', '.env', 'dist/']) expect(gi).toContain(item)
    expect(gi).toContain('!.env.example')
  })

  it('nenhum segredo vai para o código do navegador', async () => {
    const { readdir } = await import('node:fs/promises')
    const arquivos = async (dir) => (await readdir(raiz(dir), { recursive: true })).filter((f) => f.endsWith('.js')).map((f) => `${dir}/${f}`)
    for (const f of await arquivos('src')) {
      const texto = await ler(f)
      expect(texto, f).not.toMatch(/GOOGLE_CLIENT_SECRET|TOKEN_ENCRYPTION_KEY|SESSION_SECRET|DATABASE_URL/)
    }
  })
})

describe('front-end preservado', () => {
  it('Spotify: PKCE sem segredo e redirect acompanha a origem (dev e produção)', async () => {
    const s = await ler('src/modules/spotify.js')
    expect(s).toMatch(/code_challenge/)
    expect(s).toMatch(/code_verifier/)
    expect(s).toMatch(/window\.location\.origin\}\/callback/)
    expect(s).not.toMatch(/client_secret/i)
  })

  it('pesquisa do Google continua abrindo os resultados em nova guia', async () => {
    const html = await ler('index.html')
    expect(html).toMatch(/<form[^>]*google\.com\/search[^>]*>/)
    expect(html).toMatch(/target="_blank"/)
  })

  it('as cinco páginas continuam na configuração de build', async () => {
    const v = await ler('vite.config.js')
    for (const p of ['index.html', 'financeiro.html', 'favoritos.html', 'agenda.html', 'lazer.html']) expect(v).toContain(p)
  })
})
