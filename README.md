# DSHGM | Dashboard Pessoal — v1.0

Dashboard pessoal minimalista (visual verde-petróleo/ciano) para usar como página inicial do navegador. Reúne relógio, clima, pesquisa do Google, tarefas, financeiro, agenda com **sincronização bidirecional com o Google Calendar**, favoritos, biblioteca de lazer e player do Spotify. Os dados ficam na **sua conta** (login com Google), e não mais só no navegador, então acompanham você em qualquer dispositivo.

> Projeto pessoal, desenhado para **uma conta autorizada** (lista de e-mails permitidos). Não é um serviço multiusuário aberto.

## Funcionalidades

| Módulo | O que faz |
|---|---|
| **Início** | Saudação, data e relógio, clima, pesquisa do Google (abre em nova guia), atalhos, próximas tarefas e eventos, saldo do mês |
| **Tarefas** | Únicas e recorrentes (dias da semana), conclusão por dia, progresso do dia |
| **Financeiro** | Receitas, despesas e dinheiro guardado, filtros por mês/ano, gráfico por categoria, meta financeira, relatório em PDF |
| **Agenda** | Calendário mensal, eventos com recorrência e exceções, categorias, painel de conexão com o Google Calendar |
| **Favoritos** | Links por categoria, atalhos fixados na página inicial |
| **Lazer** | Biblioteca de jogos, filmes e séries com status, progresso, capas e sorteio |
| **Spotify** | Player (Web Playback SDK, requer Premium) com login PKCE |
| **Perfil** | Cores, fundo, densidade, hora 24h, início da semana, cidade do clima, foto |

Tarefas e eventos do calendário são **entidades independentes**: uma tarefa nunca vira evento.

## Tecnologias
- **Front-end:** Vite + JavaScript (sem framework), HTML/CSS próprios
- **Back-end:** Node.js + Express, empacotado como função serverless do Netlify
- **Banco:** PostgreSQL no [Neon](https://neon.tech) (driver HTTP, sem conexões persistentes), migrações SQL versionadas
- **Autenticação:** Google OAuth 2.0 / OpenID Connect (fluxo de código no servidor, PKCE)
- **Integrações:** Google Calendar API, Spotify Web API/Web Playback SDK, Open-Meteo (clima)
- **Testes:** Vitest + Supertest + PGlite (PostgreSQL real em memória)

## Como funciona (resumo)
```
Navegador ──(cookie de sessão HttpOnly)──► /api/* (função Netlify, Express) ──► Neon (PostgreSQL)
                                                  └──► Google OAuth / Google Calendar
Spotify: o navegador fala direto com o Spotify (PKCE); a conta Google não interfere.
```
O servidor identifica o usuário só pela sessão (nunca por um `user_id` enviado pelo navegador), valida toda entrada e isola os dados por conta.

## Rodando localmente
Requisitos: Node.js ≥ 20.6, uma conta no Neon e um projeto no Google Cloud.

```bash
npm install
cp .env.example .env        # Windows: copy .env.example .env
npm run gerar-chaves        # gera SESSION_SECRET e TOKEN_ENCRYPTION_KEY
# preencha o .env (veja docs/DEPLOY.md, seção "Variáveis de ambiente")
npm run migrate             # cria as tabelas no banco
npm run dev:api             # terminal 1: API em http://127.0.0.1:3001
npm run dev                 # terminal 2: site em http://127.0.0.1:5173
```
Abra **http://127.0.0.1:5173** (não `localhost`): o OAuth e o Spotify usam esse endereço.


## Segurança
- Segredos apenas no servidor (variáveis de ambiente); o navegador nunca recebe tokens do Google.
- Sessão por cookie `HttpOnly`/`Secure`/`SameSite=Lax` (`__Host-` em produção); só o hash do identificador fica no banco; expira por inatividade (14 dias) e no máximo em 30 dias; nova sessão a cada login.
- Proteção CSRF por token, verificação de origem, PKCE, `state` e `nonce`, sem redirecionamento aberto.
- **Acesso restrito por e-mail** (`ALLOWED_EMAILS`): verificada antes de criar usuário ou sessão e a cada requisição.
- Consultas parametrizadas, validação de toda entrada, upload de imagem conferido pela assinatura do arquivo.
- Refresh token do Google Calendar criptografado (AES-256-GCM) e revogado ao desconectar.
- Cabeçalhos de segurança no `netlify.toml`. A política de conteúdo (CSP) completa está em modo `Report-Only`: valide no console do navegador antes de torná-la obrigatória.
- O limite de requisições é **por instância** da função (não é um limite global).

## Google Calendar: comportamento e limites
- **Não é instantâneo.** Sincroniza ao abrir a agenda, ao voltar para a aba, após cada alteração local e a cada 15 minutos (agendador do Netlify).
- A primeira sincronização importa eventos a partir de 90 dias atrás e as recorrências ainda ativas.
- Lembretes usam as **notificações nativas** do Google Calendar; o dashboard não envia notificações próprias.
- Recorrências suportadas: diária, semanal (dias), mensal e anual, com data final e exceções. Regras mais complexas (ex.: "primeira segunda do mês") ficam **somente leitura**. Ocorrências isoladas alteradas no Google não são representadas.
- Eventos que atravessam a meia-noite são truncados em 23:59; aniversários, foco e similares são ignorados.
- Conflitos: vence a alteração mais recente; exclusão no Google prevalece sobre edição local simultânea.
- No Google Cloud em modo **Teste**, o acesso ao calendário expira em 7 dias (reconectar); publicar o app remove esse limite.

## Limitações conhecidas
- Fotos de perfil e capas são guardadas no PostgreSQL (limite de 600 KB cada); para volumes grandes, migre para armazenamento de objetos.
- Sem notificações push do Calendar (canais `watch`).
- Uso pensado para um único usuário autorizado.

## Estrutura do repositório
```
src/               front-end (páginas, módulos, serviços e estilos)
server/            API (rotas, serviços, repositórios, middlewares)
netlify/functions/ api.js (Express serverless) e calendar-sync.js (agendador)
db/migrations/     SQL versionado (somente aditivo)
scripts/           migrate.js e gerar-chaves.js
tests/             suíte automatizada
docs/              API.md e DEPLOY.md
```

## Migração de dados do navegador (versões antigas)
Quem usava a versão que guardava tudo no `localStorage` tem os dados importados automaticamente no primeiro login (tarefas, financeiro, meta, agenda, favoritos, lazer com capas e preferências). A importação é idempotente, só apaga o dado local depois que o servidor confirma e guarda uma cópia de segurança de qualquer registro rejeitado.

## Licença
Nenhuma licença foi definida: todos os direitos reservados ao autor. Para permitir o uso por terceiros, adicione uma licença (por exemplo MIT).
