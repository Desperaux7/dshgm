import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cliente, criarAmbiente, entrar } from './helpers.js'
import {
  cicloDaFatura,
  dividirEmParcelas,
  mesDaFatura,
  montarAgenda,
  somarMesesNaData,
  statusDaFatura
} from '../server/lib/cartoes.js'

// "Hoje" fixo para os testes não dependerem do relógio: 23/10/2026.
const HOJE = new Date('2026-10-23T15:00:00Z')

describe('ciclos e parcelas (regras puras)', () => {
  it('compra até o dia do fechamento entra na fatura do mês; depois, na seguinte', () => {
    expect(mesDaFatura('2026-10-10', 10)).toBe('2026-10')
    expect(mesDaFatura('2026-10-11', 10)).toBe('2026-11')
    expect(mesDaFatura('2026-12-31', 20)).toBe('2027-01')
  })

  it('vencimento: mesmo mês se vem depois do fechamento, senão no mês seguinte', () => {
    expect(cicloDaFatura('2026-10', 10, 20)).toEqual({ mesRef: '2026-10', inicio: '2026-09-11', fechamento: '2026-10-10', vencimento: '2026-10-20' })
    expect(cicloDaFatura('2026-10', 28, 5)).toEqual({ mesRef: '2026-10', inicio: '2026-09-29', fechamento: '2026-10-28', vencimento: '2026-11-05' })
    expect(cicloDaFatura('2026-12', 20, 5).vencimento).toBe('2027-01-05')
  })

  it('meses com menos dias: dia 31 fecha no último dia do mês (inclusive ano bissexto)', () => {
    expect(cicloDaFatura('2027-02', 31, 10)).toEqual({ mesRef: '2027-02', inicio: '2027-02-01', fechamento: '2027-02-28', vencimento: '2027-03-10' })
    expect(cicloDaFatura('2028-02', 31, 10).fechamento).toBe('2028-02-29')
    expect(cicloDaFatura('2027-03', 31, 10).inicio).toBe('2027-03-01')
    expect(somarMesesNaData('2026-01-31', 1)).toBe('2026-02-28')
    expect(somarMesesNaData('2026-11-30', 3)).toBe('2027-02-28')
  })

  it('divide sem perder centavos: o arredondamento sobra para a última parcela', () => {
    expect(dividirEmParcelas(10000, 3)).toEqual([3333, 3333, 3334])
    expect(dividirEmParcelas(-1000, 3)).toEqual([-333, -333, -334])
    expect(dividirEmParcelas(1, 1)).toEqual([1])
    for (const [total, n] of [[99999, 7], [1234567, 12], [100, 48]]) {
      expect(dividirEmParcelas(total, n).reduce((s, v) => s + v, 0)).toBe(total)
    }
  })

  it('agenda: cada parcela cai numa fatura própria, virando o ano', () => {
    const { itens, ciclos } = montarAgenda({ data: '2026-11-20', totalCentavos: 30000, parcelas: 3, diaFechamento: 10, diaVencimento: 20 })
    expect(itens.map((i) => i.mesRef)).toEqual(['2026-12', '2027-01', '2027-02'])
    expect(itens.map((i) => i.competencia)).toEqual(['2026-11-20', '2026-12-20', '2027-01-20'])
    expect(ciclos).toHaveLength(3)
  })

  it('status depende só das datas e dos valores', () => {
    const base = { total: 100, pago: 0, fechamento: '2026-10-10', vencimento: '2026-10-20' }
    expect(statusDaFatura({ ...base, hoje: '2026-10-10' })).toBe('aberta')
    expect(statusDaFatura({ ...base, hoje: '2026-10-11' })).toBe('fechada')
    expect(statusDaFatura({ ...base, pago: 40, hoje: '2026-10-15' })).toBe('parcialmente_paga')
    expect(statusDaFatura({ ...base, pago: 40, hoje: '2026-10-21' })).toBe('vencida')
    expect(statusDaFatura({ ...base, pago: 100, hoje: '2026-10-21' })).toBe('paga')
    expect(statusDaFatura({ ...base, total: 0, hoje: '2026-10-21' })).toBe('paga')
  })
})

let amb, c, c2
beforeAll(async () => {
  amb = await criarAmbiente({ relogio: () => HOJE })
  c = cliente(await entrar(amb.app, { sub: 'cartao-a' }))
  c2 = cliente(await entrar(amb.app, { sub: 'cartao-b' }))
})
afterAll(() => amb.fechar())

let seq = 0
const chave = () => `chave-teste-${++seq}-${Math.random().toString(36).slice(2)}`
const novoCartao = async (cli, extra = {}) =>
  (await cli.post('/api/cartoes', { nome: 'Cartão', instituicao: 'Banco', limite: 5000, diaFechamento: 28, diaVencimento: 5, ...extra })).body.cartao
const comprar = (cli, cartaoId, extra = {}) =>
  cli.post('/api/cartoes/compras', { cartaoId, descricao: 'Compra', categoria: 'Lazer', valor: 100, data: '2026-10-05', chave: chave(), ...extra })
const lancamentos = async (cli, query = '') => (await cli.get(`/api/cartoes/lancamentos${query}`)).body.lancamentos
const faturas = async (cli, query = '') => (await cli.get(`/api/cartoes/faturas${query}`)).body.faturas

describe('cartões', () => {
  it('cadastra, edita, desativa e valida', async () => {
    const r = await c.post('/api/cartoes', { nome: ' Nu ', instituicao: 'Nubank', limite: 3500.5, diaFechamento: 10, diaVencimento: 17 })
    expect(r.status).toBe(201)
    expect(r.body.cartao).toMatchObject({ nome: 'Nu', limite: 3500.5, usado: 0, disponivel: 3500.5, ativo: true })

    expect((await c.post('/api/cartoes', { nome: 'X', limite: 0, diaFechamento: 10, diaVencimento: 17 })).status).toBe(400)
    expect((await c.post('/api/cartoes', { nome: 'X', limite: 100, diaFechamento: 32, diaVencimento: 17 })).status).toBe(400)
    expect((await c.post('/api/cartoes', { nome: 'X', limite: 100, diaFechamento: 10, diaVencimento: 0 })).status).toBe(400)

    const id = r.body.cartao.id
    expect((await c.patch(`/api/cartoes/${id}`, { limite: 4000 })).body.cartao.limite).toBe(4000)

    expect((await c.patch(`/api/cartoes/${id}`, { ativo: false })).body.cartao.ativo).toBe(false)
    const compra = await comprar(c, id)
    expect(compra.status).toBe(400) // cartão desativado não recebe compras
  })

  it('não guarda número do cartão, CVV nem credenciais (o corpo só aceita os campos do cadastro)', async () => {
    const r = await c.post('/api/cartoes', { nome: 'Seguro', limite: 100, diaFechamento: 1, diaVencimento: 2, numero: '4111111111111111', cvv: '123' })
    expect(r.status).toBe(201)
    expect(JSON.stringify(r.body)).not.toContain('4111')
    const cols = await amb.db.query("select column_name from information_schema.columns where table_name = 'credit_cards'")
    expect(cols.map((x) => x.column_name).join(',')).not.toMatch(/number|numero|cvv|password|senha/)
  })
})

describe('compras, parcelas e faturas', () => {
  it('compra à vista cai na fatura certa e reduz o limite disponível', async () => {
    const cartao = await novoCartao(c, { nome: 'À vista' })
    const r = await comprar(c, cartao.id, { valor: 120, data: '2026-10-05' })
    expect(r.status).toBe(201)

    const [l] = await lancamentos(c, `?cartao=${cartao.id}`)
    expect(l).toMatchObject({ valor: 120, numero: 1, parcelas: 1, faturaMes: '2026-10', competencia: '2026-10-05', statusFatura: 'aberta' })

    const [f] = await faturas(c, `?cartao=${cartao.id}`)
    expect(f).toMatchObject({ mesRef: '2026-10', inicio: '2026-09-29', fechamento: '2026-10-28', vencimento: '2026-11-05', total: 120, pago: 0, pendente: 120, status: 'aberta' })

    const painel = (await c.get('/api/cartoes/painel')).body
    const cp = painel.cartoes.find((x) => x.id === cartao.id)
    expect(cp).toMatchObject({ usado: 120, disponivel: 4880 })
    expect(cp.faturaAtual).toMatchObject({ mesRef: '2026-10', total: 120, status: 'aberta' })
  })

  it('compra parcelada gera todas as parcelas, uma por fatura, e a soma fecha no centavo', async () => {
    const cartao = await novoCartao(c, { nome: 'Parcelado' })
    expect((await comprar(c, cartao.id, { valor: 100, parcelas: 3, data: '2026-10-30' })).status).toBe(201)

    const ls = (await lancamentos(c, `?cartao=${cartao.id}`)).sort((a, b) => a.numero - b.numero)
    expect(ls.map((l) => l.valor)).toEqual([33.33, 33.33, 33.34])
    expect(ls.map((l) => l.faturaMes)).toEqual(['2026-11', '2026-12', '2027-01'])
    expect(ls.map((l) => l.competencia)).toEqual(['2026-10-30', '2026-11-30', '2026-12-30'])
    expect(Math.round(ls.reduce((s, l) => s + l.valor, 0) * 100)).toBe(10000)

    const fs = await faturas(c, `?cartao=${cartao.id}`)
    expect(fs).toHaveLength(3)
    // O limite fica comprometido pelo total (inclusive parcelas futuras).
    const cp = (await c.get('/api/cartoes/painel')).body.cartoes.find((x) => x.id === cartao.id)
    expect(cp.usado).toBe(100)
  })

  it('fechamento no dia 31 em mês curto e virada de ano', async () => {
    const cartao = await novoCartao(c, { nome: 'Dia 31', diaFechamento: 31, diaVencimento: 10 })
    await comprar(c, cartao.id, { valor: 90, parcelas: 3, data: '2027-01-31' })
    const fs = (await faturas(c, `?cartao=${cartao.id}`)).sort((a, b) => a.mesRef.localeCompare(b.mesRef))
    expect(fs.map((f) => [f.mesRef, f.fechamento, f.vencimento])).toEqual([
      ['2027-01', '2027-01-31', '2027-02-10'],
      ['2027-02', '2027-02-28', '2027-03-10'],
      ['2027-03', '2027-03-31', '2027-04-10']
    ])
  })

  it('o status é calculado pela data, sem ninguém abrir a tela no fechamento', async () => {
    const cartao = await novoCartao(c, { nome: 'Status', diaFechamento: 10, diaVencimento: 28 })
    await comprar(c, cartao.id, { valor: 200, data: '2026-09-05' }) // fatura set/2026: fechou 10/09, venceu 28/09
    await comprar(c, cartao.id, { valor: 300, data: '2026-10-05' }) // fatura out/2026: fechou 10/10, vence 28/10
    await comprar(c, cartao.id, { valor: 50, data: '2026-10-20' }) // fatura nov/2026: ainda aberta

    const fs = Object.fromEntries((await faturas(c, `?cartao=${cartao.id}`)).map((f) => [f.mesRef, f]))
    expect(fs['2026-09'].status).toBe('vencida')
    expect(fs['2026-10'].status).toBe('fechada')
    expect(fs['2026-11'].status).toBe('aberta')
    expect((await faturas(c, `?cartao=${cartao.id}&status=vencida`)).map((f) => f.mesRef)).toEqual(['2026-09'])

    const painel = (await c.get('/api/cartoes/painel')).body
    expect(painel.totais.vencidas).toBeGreaterThan(0)
    expect(painel.totais.proximoVencimento.status).toBe('vencida')
  })

  it('estorno e ajuste mexem na fatura sem virar compra', async () => {
    const cartao = await novoCartao(c, { nome: 'Estorno' })
    await comprar(c, cartao.id, { valor: 100, data: '2026-10-05' })
    await comprar(c, cartao.id, { tipo: 'estorno', descricao: 'Devolução', valor: 30, data: '2026-10-06' })
    await comprar(c, cartao.id, { tipo: 'ajuste', sentido: 'cobranca', descricao: 'Anuidade', valor: 10, data: '2026-10-07' })
    await comprar(c, cartao.id, { tipo: 'ajuste', sentido: 'credito', descricao: 'Desconto', valor: 5, data: '2026-10-08' })
    const [f] = await faturas(c, `?cartao=${cartao.id}`)
    expect(f.total).toBe(75)
    expect((await comprar(c, cartao.id, { tipo: 'estorno', valor: 10, parcelas: 2 })).status).toBe(400)
    expect((await comprar(c, cartao.id, { valor: 0.01, parcelas: 2 })).status).toBe(400)
  })

  it('o mesmo envio repetido (chave) registra uma compra só', async () => {
    const cartao = await novoCartao(c, { nome: 'Idempotente' })
    const k = chave()
    const a = await comprar(c, cartao.id, { valor: 60, parcelas: 2, chave: k })
    const b = await comprar(c, cartao.id, { valor: 60, parcelas: 2, chave: k })
    expect(a.status).toBe(201)
    expect(b.status).toBe(200)
    expect(b.body.repetida).toBe(true)
    expect(await lancamentos(c, `?cartao=${cartao.id}`)).toHaveLength(2)
  })
})

describe('pagamentos e a regra de não contar a despesa duas vezes', () => {
  it('pagamento parcial mantém o saldo pendente; integral quita; excedente é recusado', async () => {
    const cartao = await novoCartao(c, { nome: 'Pagamentos', diaFechamento: 10, diaVencimento: 28 })
    await comprar(c, cartao.id, { valor: 300, data: '2026-10-05' }) // fechada, vence 28/10
    const [f] = await faturas(c, `?cartao=${cartao.id}`)

    const p1 = await c.post('/api/cartoes/pagamentos', { faturaId: f.id, valor: 100, data: '2026-10-23', chave: chave() })
    expect(p1.status).toBe(201)
    let [atual] = await faturas(c, `?cartao=${cartao.id}`)
    expect(atual).toMatchObject({ pago: 100, pendente: 200, status: 'parcialmente_paga' })

    expect((await c.post('/api/cartoes/pagamentos', { faturaId: f.id, valor: 200.01, data: '2026-10-23', chave: chave() })).status).toBe(400)

    const p2 = await c.post('/api/cartoes/pagamentos', { faturaId: f.id, valor: 200, data: '2026-10-24', chave: chave() })
    expect(p2.status).toBe(201)
    ;[atual] = await faturas(c, `?cartao=${cartao.id}`)
    expect(atual).toMatchObject({ pago: 300, pendente: 0, status: 'paga' })
    expect((await c.post('/api/cartoes/pagamentos', { faturaId: f.id, valor: 1, data: '2026-10-24', chave: chave() })).status).toBe(400)

    // Desfazer um pagamento devolve o saldo.
    await c.delete(`/api/cartoes/pagamentos/${p2.body.pagamentoId}`)
    ;[atual] = await faturas(c, `?cartao=${cartao.id}`)
    expect(atual).toMatchObject({ pago: 100, pendente: 200 })
  })

  it('pagamento repetido (mesma chave) não é lançado duas vezes', async () => {
    const cartao = await novoCartao(c, { nome: 'Dupla' })
    await comprar(c, cartao.id, { valor: 80, data: '2026-10-05' })
    const [f] = await faturas(c, `?cartao=${cartao.id}`)
    const k = chave()
    const a = await c.post('/api/cartoes/pagamentos', { faturaId: f.id, valor: 30, data: '2026-10-23', chave: k })
    const b = await c.post('/api/cartoes/pagamentos', { faturaId: f.id, valor: 30, data: '2026-10-23', chave: k })
    expect(a.status).toBe(201)
    expect(b.status).toBe(200)
    expect(b.body.repetido).toBe(true)
    expect((await faturas(c, `?cartao=${cartao.id}`))[0].pago).toBe(30)
  })

  it('despesa contada uma vez: consumo reduz o saldo, o pagamento é só caixa', async () => {
    const u = cliente(await entrar(amb.app, { sub: 'cartao-resumo' }))
    await u.post('/api/transacoes', { type: 'income', description: 'Salário', category: 'Salário', amount: 5000, date: '2026-10-01' })
    await u.post('/api/transacoes', { type: 'expense', description: 'Mercado', category: 'Alimentação', amount: 50, date: '2026-10-02' })
    const cartao = await novoCartao(u, { diaFechamento: 10, diaVencimento: 28 })
    await comprar(u, cartao.id, { valor: 120, data: '2026-10-05', categoria: 'Lazer' })
    await comprar(u, cartao.id, { valor: 300, parcelas: 3, data: '2026-10-06', categoria: 'Moradia' }) // 100 por mês

    let r = (await u.get('/api/transacoes/resumo?mes=2026-10')).body.resumo
    expect(r).toMatchObject({ entradas: 5000, despesas: 270, despesasCartao: 220, saldo: 4730, caixa: 4950, pagamentosFatura: 0, faturasPendentes: 420 })

    const [f] = (await faturas(u)).filter((x) => x.mesRef === '2026-10')
    await u.post('/api/cartoes/pagamentos', { faturaId: f.id, valor: 220, data: '2026-10-23', chave: chave() })

    r = (await u.get('/api/transacoes/resumo?mes=2026-10')).body.resumo
    // Mesma despesa, mesmo saldo: o pagamento só aparece como saída de caixa.
    expect(r).toMatchObject({ despesas: 270, saldo: 4730, pagamentosFatura: 220, caixa: 4730, faturasPendentes: 200 })

    // Meses seguintes recebem só as parcelas deles.
    const nov = (await u.get('/api/transacoes/resumo?mes=2026-11')).body.resumo
    expect(nov).toMatchObject({ despesas: 100, despesasCartao: 100, pagamentosFatura: 0 })

    // O consumo exposto ao Financeiro bate com o resumo e nunca inclui pagamentos.
    const consumo = (await u.get('/api/cartoes/consumo?de=2026-10-01&ate=2026-10-31')).body.consumo
    expect(consumo.map((x) => x.amount).sort((a, b) => a - b)).toEqual([100, 120])
    expect(consumo.every((x) => x.type === 'expense' && x.origem === 'cartao')).toBe(true)
    expect(consumo.find((x) => x.amount === 100).description).toBe('Compra (1/3)')
  })
})

describe('edição e exclusão preservando as faturas', () => {
  it('texto pode mudar sempre; valores só sem pagamento; as parcelas são refeitas por inteiro', async () => {
    const cartao = await novoCartao(c, { nome: 'Edição', diaFechamento: 10, diaVencimento: 28 })
    const compra = (await comprar(c, cartao.id, { valor: 100, parcelas: 3, data: '2026-09-05' })).body.compraId
    const [primeira] = (await lancamentos(c, `?cartao=${cartao.id}`)).sort((a, b) => a.numero - b.numero)
    const fat = await amb.db.query('select id from card_invoices where id = $1', [primeira.faturaId])
    await c.post('/api/cartoes/pagamentos', { faturaId: fat[0].id, valor: 10, data: '2026-10-01', chave: chave() })

    expect((await c.patch(`/api/cartoes/compras/${compra}`, { descricao: 'Notebook', categoria: 'Outros' })).status).toBe(200)
    expect((await lancamentos(c, `?cartao=${cartao.id}`))[0]).toMatchObject({ descricao: 'Notebook', categoria: 'Outros' })

    expect((await c.patch(`/api/cartoes/compras/${compra}`, { valor: 200 })).status).toBe(409)
    expect((await c.delete(`/api/cartoes/compras/${compra}`)).status).toBe(409)

    const pag = (await amb.db.query('select id from card_payments where invoice_id = $1', [fat[0].id]))[0].id
    await c.delete(`/api/cartoes/pagamentos/${pag}`)

    expect((await c.patch(`/api/cartoes/compras/${compra}`, { valor: 200, parcelas: 2 })).status).toBe(200)
    const ls = (await lancamentos(c, `?cartao=${cartao.id}`)).sort((a, b) => a.numero - b.numero)
    expect(ls.map((l) => l.valor)).toEqual([100, 100])
    expect(ls.map((l) => l.faturaMes)).toEqual(['2026-09', '2026-10'])
    const orfas = await amb.db.query('select count(*)::int as n from card_installments where purchase_id = $1', [compra])
    expect(orfas[0].n).toBe(2)

    expect((await c.delete(`/api/cartoes/compras/${compra}`)).status).toBe(204)
    expect(await lancamentos(c, `?cartao=${cartao.id}`)).toHaveLength(0)
    const [r] = await amb.db.query('select count(*)::int as n from card_installments where purchase_id = $1', [compra])
    expect(r.n).toBe(0)
  })

  it('mudar de cartão move as parcelas para as faturas do outro', async () => {
    const a = await novoCartao(c, { nome: 'Origem', diaFechamento: 10, diaVencimento: 28 })
    const b = await novoCartao(c, { nome: 'Destino', diaFechamento: 20, diaVencimento: 5 })
    const compra = (await comprar(c, a.id, { valor: 50, data: '2026-10-15' })).body.compraId
    expect((await c.patch(`/api/cartoes/compras/${compra}`, { cartaoId: b.id })).status).toBe(200)
    const [l] = await lancamentos(c, `?cartao=${b.id}`)
    expect(l).toMatchObject({ cartaoId: b.id, faturaMes: '2026-10' })
    expect(await lancamentos(c, `?cartao=${a.id}`)).toHaveLength(0)
  })
})

describe('isolamento e integridade', () => {
  it('cada conta enxerga e altera só o que é seu', async () => {
    const cartao = await novoCartao(c, { nome: 'Privado' })
    const compra = (await comprar(c, cartao.id, { valor: 40, data: '2026-10-05' })).body.compraId
    const [f] = await faturas(c, `?cartao=${cartao.id}`)
    const pag = (await c.post('/api/cartoes/pagamentos', { faturaId: f.id, valor: 10, data: '2026-10-23', chave: chave() })).body.pagamentoId

    expect((await c2.get('/api/cartoes')).body.cartoes.some((x) => x.id === cartao.id)).toBe(false)
    expect(await faturas(c2)).toHaveLength(0)
    expect(await lancamentos(c2)).toHaveLength(0)
    expect((await c2.get('/api/cartoes/consumo')).body.consumo).toHaveLength(0)
    expect((await c2.get(`/api/cartoes/faturas/${f.id}`)).status).toBe(404)
    expect((await c2.patch(`/api/cartoes/${cartao.id}`, { nome: 'invadido' })).status).toBe(404)
    expect((await comprar(c2, cartao.id)).status).toBe(404)
    expect((await c2.patch(`/api/cartoes/compras/${compra}`, { descricao: 'x' })).status).toBe(404)
    expect((await c2.delete(`/api/cartoes/compras/${compra}`)).status).toBe(404)
    expect((await c2.post('/api/cartoes/pagamentos', { faturaId: f.id, valor: 5, data: '2026-10-23' })).status).toBe(404)
    expect((await c2.delete(`/api/cartoes/pagamentos/${pag}`)).status).toBe(404)
    expect((await c2.get('/api/cartoes/painel')).body.totais.aPagar).toBe(0)
  })

  it('o banco impede estados inconsistentes', async () => {
    const [u] = await amb.db.query('select id from users limit 1')
    const insercao = (sql) => amb.db.query(sql, [u.id]).then(() => 'ok', () => 'erro')
    // Pagamento sem fatura/cartão existentes (integridade referencial).
    expect(await insercao("insert into card_payments (user_id, card_id, invoice_id, amount, paid_on) values ($1, gen_random_uuid(), gen_random_uuid(), 10, '2026-10-01')")).toBe('erro')
    // Cartão com limite zero e dia inválido (restrições de domínio).
    expect(await insercao("insert into credit_cards (user_id, name, credit_limit, closing_day, due_day) values ($1, 'x', 0, 10, 10)")).toBe('erro')
    expect(await insercao("insert into credit_cards (user_id, name, credit_limit, closing_day, due_day) values ($1, 'x', 10, 40, 10)")).toBe('erro')
  })

  it('contas antigas continuam iguais: sem cartões, o resumo é o de antes', async () => {
    const antigo = cliente(await entrar(amb.app, { sub: 'cartao-antigo' }))
    await antigo.post('/api/transacoes', { type: 'income', description: 'Renda', category: 'Salário', amount: 1000, date: '2026-10-01' })
    await antigo.post('/api/transacoes', { type: 'expense', description: 'Conta', category: 'Moradia', amount: 400, date: '2026-10-03' })
    const r = (await antigo.get('/api/transacoes/resumo?mes=2026-10')).body.resumo
    expect(r).toMatchObject({ entradas: 1000, despesas: 400, saldo: 600, caixa: 600, despesasCartao: 0, pagamentosFatura: 0, faturasPendentes: 0 })
  })
})
