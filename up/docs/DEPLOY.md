# Guia de implantação (GitHub → Netlify)

## 1. O que vai para o GitHub

**Envie** (o repositório pode ser público: não há segredos nesses arquivos):

```
src/  server/  netlify/  db/  scripts/  tests/  docs/  public/
index.html  financeiro.html  favoritos.html  agenda.html  lazer.html
package.json  package-lock.json  vite.config.js  vitest.config.js
netlify.toml  .env.example  .gitignore  README.md
```

**Nunca envie** (o `.gitignore` já cobre todos):

| Item | Por quê |
|---|---|
| `.env` | contém os segredos reais (banco, Google, chaves) |
| `node_modules/` | gerado pelo `npm install` (e instalado no Windows não serve para o Netlify) |
| `dist/` | gerado pelo build |
| `.netlify/` | pasta local da CLI |
| `*.zip` | pacotes de entrega |

`package-lock.json` **deve** ser enviado: ele fixa as versões e o Netlify o usa na instalação. Ele é gerado pelo seu `npm install`.

Antes do primeiro `git push`, confira:
```bash
git status            # o .env NÃO pode aparecer na lista
git ls-files | findstr /i "\.env"   # Windows: só deve listar .env.example
```
No Linux/macOS: `git ls-files | grep -i "\.env"`.

> O Client ID do Spotify no código é **público por natureza** (fluxo PKCE não usa segredo). Já o Client Secret do Google, a `DATABASE_URL`, `SESSION_SECRET` e `TOKEN_ENCRYPTION_KEY` **nunca** entram no repositório.

### Comandos
```bash
git init
git add .
git status                       # revise a lista
git commit -m "DSHGM v1.0"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/dshgm.git
git push -u origin main
```

## 2. O que fazer no Netlify (nada de arquivos é enviado manualmente)

O Netlify **lê o repositório do GitHub** e faz o build. Não use o "arrastar e soltar" (drag and drop): ele não instala dependências nem constrói as funções da API.

1. **Escolha o nome do site antes**, porque o endereço entra nas configurações do Google: `https://SEU-SITE.netlify.app`.
2. *Add new site → Import an existing project → GitHub →* escolha o repositório. O `netlify.toml` já define comando (`npm run build`), pasta (`dist`) e funções (`netlify/functions`).
3. Em *Site configuration → Environment variables*, crie as variáveis abaixo (marque **secret** nas sensíveis e deixe o escopo padrão, que inclui *Functions*).
4. Faça o deploy. Ajuste o nome do site em *Site configuration → Change site name*, se necessário.

### Variáveis de ambiente

| Variável | Valor | Secreta |
|---|---|---|
| `NODE_ENV` | `production` | não |
| `APP_URL` | `https://SEU-SITE.netlify.app` (sem barra final) | não |
| `DATABASE_URL` | connection string do Neon (de preferência de um **branch de produção**) | sim |
| `SESSION_SECRET` | gerado por `npm run gerar-chaves` (use valores **novos** para produção) | sim |
| `TOKEN_ENCRYPTION_KEY` | gerado por `npm run gerar-chaves` | sim |
| `GOOGLE_CLIENT_ID` | Google Cloud → Credenciais | não |
| `GOOGLE_CLIENT_SECRET` | Google Cloud → Credenciais | sim |
| `ALLOWED_EMAILS` | seu e-mail Google (vírgula para mais de um) | não |
| `DEFAULT_TIMEZONE` | opcional, ex.: `America/Sao_Paulo` | não |

Em produção a API **não inicia** se faltar variável obrigatória ou se `ALLOWED_EMAILS` estiver vazia (para nunca ficar aberta a qualquer conta).

## 3. Neon (banco)
1. Recomendado: crie um **branch** `production` separado do que você usa para desenvolvimento.
2. Aplique as tabelas **uma vez** apontando para o banco de produção:
   ```bash
   # Windows PowerShell
   $env:DATABASE_URL="postgresql://...produção..."; npm run migrate
   ```
   (ou ponha a string de produção temporariamente no `.env` local e depois restaure a de desenvolvimento.)
3. A cada migração nova no futuro, rode `npm run migrate` contra a produção **antes** de publicar o código que depende dela. As migrações só adicionam estruturas e nunca apagam dados.
4. Antes de mudanças grandes, use o recurso de *branch/restore* do Neon como ponto de recuperação.

## 4. Google Cloud
1. *Credenciais → seu ID do cliente OAuth →* em **URIs de redirecionamento autorizadas**, **adicione** (mantendo as de desenvolvimento):
   - `https://SEU-SITE.netlify.app/api/auth/google/callback`
   - `https://SEU-SITE.netlify.app/api/calendario/callback`
2. Deixe **Origens JavaScript autorizadas** em branco.
3. *Tela de permissão OAuth → Acesso a dados:* confirme os escopos `openid`, `email`, `profile` e `.../auth/calendar.events`. Em *Público:* seu e-mail em **Usuários de teste**.
4. Em modo *Teste*, o acesso ao calendário expira em 7 dias (basta reconectar). Para evitar, publique o app ("Em produção"): para uso pessoal você só precisa aceitar o aviso de "app não verificado".

## 5. Spotify
No painel do app, em **Redirect URIs**, adicione `https://SEU-SITE.netlify.app/callback` (mantenha `http://127.0.0.1:5173/callback` para desenvolvimento).

## 6. Verificação depois do deploy
- [ ] `https://SEU-SITE.netlify.app/api/saude` mostra `{"ok":true}`
- [ ] A página inicial mostra a tela "Entrar com Google" e o login conclui
- [ ] Nas ferramentas do navegador (F12 → Aplicativo → Cookies), o cookie `__Host-sid` tem `HttpOnly` e `Secure`
- [ ] Uma conta que **não** está em `ALLOWED_EMAILS` é recusada
- [ ] Criar uma tarefa, um lançamento financeiro, um favorito, um item de lazer e um evento, e recarregar a página
- [ ] Conectar o Google Calendar, criar um evento aqui e vê-lo no Google (e o inverso, com "Sincronizar agora")
- [ ] Spotify conecta e toca
- [ ] *Netlify → Logs → Functions* mostra o `calendar-sync` rodando a cada 15 minutos
- [ ] Console do navegador sem avisos de CSP (a política está em modo `Report-Only`); se estiver limpo, você pode trocar `Content-Security-Policy-Report-Only` por `Content-Security-Policy` no `netlify.toml`

## 7. Problemas comuns

| Sintoma | Causa provável |
|---|---|
| `/api/...` retorna 404 | redirecionamento do `netlify.toml` não aplicado; confirme que o arquivo está na raiz do repositório |
| Função retorna 500 ao abrir o site | variável de ambiente ausente ou inválida (veja *Logs → Functions*) |
| `redirect_uri_mismatch` | URI de callback diferente da cadastrada no Google (https, sem barra final, domínio exato) |
| `Error 403: access_denied` | conta fora de **Usuários de teste**, ou escopo do calendário ausente em *Acesso a dados*, ou política do Google Workspace bloqueando o app |
| Login volta sem entrar | `APP_URL` diferente do endereço aberto no navegador |
| Calendário "revogado" depois de alguns dias | app Google em modo Teste (limite de 7 dias); reconecte ou publique o app |
| Spotify: `INVALID_CLIENT: Invalid redirect URI` | URI de produção não cadastrada no painel do Spotify |

## 8. Atualizações futuras
Cada `git push` na branch `main` dispara um novo deploy. Se houver migração de banco nova, rode `npm run migrate` na produção **antes** do push.
