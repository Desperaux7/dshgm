# Referência da API

Base: `/api` (mesma origem do site). Todas as respostas são JSON, com `Cache-Control: no-store`.

**Autenticação:** cookie de sessão `HttpOnly` (`__Host-sid` em produção). **Escritas** (`POST`, `PUT`, `PATCH`, `DELETE`) exigem o cabeçalho `X-CSRF-Token` com o valor de `csrfToken` retornado por `GET /api/auth/me`.

**Erros:** `{ "erro": { "codigo": "...", "mensagem": "...", "detalhes": [...] } }`

| Status | Código | Quando |
|---|---|---|
| 400 | `validacao`, `requisicao_invalida`, `json_invalido` | Dados inválidos |
| 401 | `nao_autenticado` | Sem sessão válida |
| 403 | `proibido` | CSRF ausente/inválido ou origem não permitida |
| 404 | `nao_encontrado` | Não existe **ou pertence a outro usuário** |
| 409 | `conflito` | Ex.: editar evento com recorrência somente leitura |
| 413 | `corpo_grande` | Corpo acima do limite |
| 429 | `limite_excedido` | Muitas requisições |

## Autenticação

| Método e rota | Descrição |
|---|---|
| `GET /auth/google/start?returnTo=/pagina.html` | Inicia o login (PKCE + `state` + `nonce`). `returnTo` só aceita caminho relativo simples |
| `GET /auth/google/callback` | Retorno do Google. Cria sessão nova e redireciona. Erros: `/?erro_login=cancelado\|estado_invalido\|sessao_expirada\|falha` |
| `GET /auth/me` | `{ usuario, csrfToken }` ou 401 |
| `POST /auth/logout` | Encerra a sessão no servidor (204) |

## Tarefas (independentes de eventos)

| Rota | Corpo / observações |
|---|---|
| `GET /tarefas` | `{ tarefas: [{ id, texto, tipo, data, dias, criada, concluidas, andamento }] }` |
| `POST /tarefas` | `{ texto, tipo: 'unica'\|'recorrente', data?, dias?, criada? }` |
| `PATCH /tarefas/:id` | Qualquer subconjunto de `texto, tipo, data, dias` |
| `DELETE /tarefas/:id` | 204 |
| `PUT /tarefas/:id/concluidas/:AAAA-MM-DD` | `{ concluida: boolean }` (desmarcar volta o dia para pendente) |
| `PUT /tarefas/:id/status/:AAAA-MM-DD` | `{ status: 'pendente'\|'andamento'\|'concluida' }`. Um dia tem um estado só; resposta `{ tarefa }` |

## Financeiro

| Rota | Observações |
|---|---|
| `GET /transacoes?de=&ate=&limite=&offset=` | `limite` padrão 2000, máx. 5000 |
| `GET /transacoes/resumo?mes=AAAA-MM` | `{ resumo: { entradas, despesas, guardado, saldo, totalGuardado } }`. `saldo = entradas − despesas − guardado` |
| `POST /transacoes` | `{ type: 'expense'\|'income'\|'saving', description, category, amount, date }` |
| `PATCH /transacoes/:id`, `DELETE /transacoes/:id` | |
| `GET/PUT/DELETE /meta` | `{ nome?, valor, prazo: 'AAAA-MM' }` |
| `GET /categorias`, `POST /categorias`, `DELETE /categorias/:id` | Categorias próprias: `{ tipo: 'expense'\|'income'\|'saving', nome (1–40) }`. Criar repetido devolve a existente; máx. 60 por conta. Apagar não altera movimentações já registradas |

## Cartões de crédito

Regra financeira: a compra é **consumo** no mês de cada parcela (entra em `despesas` uma única vez); o fechamento só
consolida a fatura; o **pagamento** da fatura é saída de caixa e **não** cria despesa nem altera o `saldo`.
Nunca são guardados número do cartão, CVV ou credenciais.

| Rota | Observações |
|---|---|
| `GET /cartoes`, `POST /cartoes`, `PATCH /cartoes/:id` | `{ nome, instituicao?, limite, diaFechamento 1-31, diaVencimento 1-31, ativo? }`. Desativar = `ativo: false` (não há exclusão: o histórico permanece). Máx. 20 cartões. Mudar os dias vale para faturas futuras |
| `GET /cartoes/painel` | `{ hoje, cartoes: [{ ..., usado, disponivel, faturaAtual }], totais: { limiteTotal, usado, disponivel, aPagar, vencidas, pagoNoMes, proximoVencimento } }` |
| `GET /cartoes/faturas?cartao=&status=&de=&ate=` | Faturas com `total`, `pago`, `pendente` e `status` (`aberta`, `fechada`, `parcialmente_paga`, `paga`, `vencida`), calculado pela data de hoje no fuso da conta. `de`/`ate` filtram pelo fechamento |
| `GET /cartoes/faturas/:id` | `{ fatura, lancamentos, pagamentos }` |
| `GET /cartoes/lancamentos?cartao=&status=&de=&ate=` | Parcelas com a fatura de cada uma. `de`/`ate` filtram pela competência (mês de consumo) |
| `GET /cartoes/consumo?de=&ate=` | Parcelas no formato de movimentação do Financeiro (`type: 'expense'`, `origem: 'cartao'`) |
| `POST /cartoes/compras` | `{ cartaoId, tipo: 'compra'\|'estorno'\|'ajuste', sentido?: 'cobranca'\|'credito' (ajuste), descricao, categoria, valor, parcelas 1-48, data, chave? }`. Gera todas as parcelas e as faturas que faltarem, numa única instrução. `chave` repetida devolve `200 { repetida: true }` |
| `PATCH /cartoes/compras/:id` | Só texto (`descricao`, `categoria`): sempre. Valor/parcelas/data/cartão: refaz as parcelas, e dá `409` se alguma fatura envolvida tiver pagamento |
| `DELETE /cartoes/compras/:id` | `409` se alguma fatura da compra tiver pagamento |
| `POST /cartoes/pagamentos` | `{ faturaId, valor, data, chave? }`. `400` se passar do saldo pendente; `chave` repetida devolve `200 { repetido: true }` |
| `DELETE /cartoes/pagamentos/:id` | Devolve o valor ao saldo pendente da fatura |

Ciclos: a fatura de um mês cobre do dia seguinte ao fechamento anterior até o fechamento (inclusive); o vencimento é o
primeiro `diaVencimento` depois do fechamento; em meses curtos, o dia 31 vale o último dia. As parcelas são divididas em
centavos e a diferença de arredondamento fica na última. `GET /transacoes/resumo` ganhou `despesasCartao`,
`pagamentosFatura`, `caixa` e `faturasPendentes` (sem cartões, `despesas` e `saldo` não mudam).

## Favoritos, Lazer, Preferências

| Rota | Observações |
|---|---|
| `GET/POST /favoritos`, `PATCH/DELETE /favoritos/:id` | `{ nome, url (http/https), categoria?, fixado? }` |
| `GET/POST /lazer`, `PATCH/DELETE /lazer/:id` | `{ tipo, titulo, plataforma?, status? }` (`progresso` ainda é aceito, mas a tela não o usa mais) |
| `PUT /lazer/:id/capa` | Corpo binário `image/jpeg\|png\|webp` (máx. 600 KB), cabeçalhos `X-Largura` e `X-Altura`. Assinatura do arquivo é conferida |
| `GET /lazer/:id/capa`, `DELETE /lazer/:id/capa` | |
| `GET /preferencias`, `PATCH /preferencias` | Mescla parcial; `foto` (data URL ≤ 600 KB) ou `null` |
| `PUT /fuso` | `{ fuso: 'America/Sao_Paulo' }` (usado nas conversões do calendário) |

## Agenda e Google Calendar

| Rota | Observações |
|---|---|
| `GET /eventos` | Eventos-base (a interface expande as recorrências). Cada um traz `sincronizacao: { estado, erro, somenteLeitura }` |
| `POST /eventos`, `PATCH /eventos/:id`, `DELETE /eventos/:id` | Modelo: `titulo, data, diaInteiro, inicio, fim, categoria, notas, rec: { tipo, dias, ate }, excecoes`. Se o calendário estiver conectado, é enviado ao Google na hora; se falhar, fica `pending` |
| `GET /calendario/conectar` | Inicia a autorização **separada** do calendário (escopo `calendar.events`) |
| `GET /calendario/callback` | Retorno do Google → `/agenda.html?calendario=conectado\|cancelado\|permissao_negada\|falha\|...` |
| `GET /calendario/status` | `{ conectado, estado, email, ultimaSincronizacao, erro, eventosPorEstado }` |
| `POST /calendario/sincronizar` | `{ forcar?: boolean }`. Sem `forcar`, ignora se sincronizou há menos de 30 s |
| `DELETE /calendario/conexao` | Revoga a credencial no Google, apaga o vínculo; eventos locais permanecem |

Estados de sincronização de um evento: `local` (sem conexão), `pending`, `synced`, `error`, `pending_delete`, `readonly`.

## Migração dos dados locais

`POST /importacao` com corpo `{ tarefas, transacoes, meta, favoritos, lazer, agenda, preferencias }` (formatos do `localStorage` antigo).
Resposta: `{ resultado: { tarefas: { recebidos, importados, jaExistiam, rejeitados: [{ indice, motivo }] }, ..., mapaLazer: { idAntigo: idNovo } } }`.
Idempotente (id antigo → `client_id`). Preferências e meta só entram se o servidor ainda não tiver as suas.
