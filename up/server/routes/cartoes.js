import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import { assincrono, conflito, naoEncontrado, requisicaoInvalida } from '../lib/errors.js'
import { formatarNoFuso } from '../lib/dates.js'
import { uuidDaRota, validar, zData, zTexto, zValor } from '../lib/validate.js'
import {
  centavosParaDecimal,
  cicloDaFatura,
  mesDaFatura,
  montarAgenda,
  paraCentavos,
  statusDaFatura
} from '../lib/cartoes.js'

const LIMITE_CARTOES = 20
const zDia = z.number().int('Informe um dia inteiro.').min(1, 'Dia entre 1 e 31.').max(31, 'Dia entre 1 e 31.')
const zUuidCorpo = z.string().uuid('Identificador inválido.')
const zChave = z.string().min(8).max(80).optional()

const zCartao = z.object({
  nome: zTexto(1, 60),
  instituicao: zTexto(0, 60).default(''),
  limite: zValor,
  diaFechamento: zDia,
  diaVencimento: zDia
})
const zCartaoAtualizar = zCartao.partial().extend({ ativo: z.boolean().optional() })

const zCompra = z.object({
  cartaoId: zUuidCorpo,
  tipo: z.enum(['compra', 'estorno', 'ajuste']).default('compra'),
  sentido: z.enum(['cobranca', 'credito']).default('cobranca'), // só para ajuste
  descricao: zTexto(1, 200),
  categoria: zTexto(1, 60),
  valor: zValor,
  parcelas: z.number().int().min(1).max(48).default(1),
  data: zData,
  chave: zChave
})
const zCompraAtualizar = zCompra.partial().omit({ chave: true })

const zPagamento = z.object({ faturaId: zUuidCorpo, valor: zValor, data: zData, chave: zChave })
const zMes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês inválido (use AAAA-MM).')
const STATUS = ['aberta', 'fechada', 'parcialmente_paga', 'paga', 'vencida']
const zConsultaFaturas = z.object({
  cartao: zUuidCorpo.optional(),
  status: z.enum(STATUS).optional(),
  de: zData.optional(),
  ate: zData.optional()
})
const zConsultaLancamentos = zConsultaFaturas.extend({ limite: z.coerce.number().int().min(1).max(2000).default(1000) })

const TIPO_SQL = { compra: 'purchase', estorno: 'refund', ajuste: 'adjustment' }
const arredondar = (v) => Math.round(v * 100) / 100

// `relogio` permite fixar "hoje" nos testes; em produção é o relógio real, no fuso da conta.
export function criarRotasCartoes({ repos, relogio = () => new Date() }) {
  const router = Router()
  const { cartoes } = repos

  const hojeDe = (usuario) => formatarNoFuso(relogio(), usuario.timezone).data
  const comStatus = (fatura, hoje) => ({
    ...fatura,
    status: statusDaFatura({ total: fatura.total, pago: fatura.pago, fechamento: fatura.fechamento, vencimento: fatura.vencimento, hoje })
  })

  async function cartaoDoUsuario(userId, id) {
    const cartao = await cartoes.obterCartao(userId, id)
    if (!cartao) throw naoEncontrado('Cartão não encontrado.')
    return cartao
  }

  // Valida a compra e monta o calendário de parcelas (cada parcela com sua fatura).
  function planejar(dados, cartao) {
    const sinal = dados.tipo === 'estorno' ? -1 : dados.tipo === 'ajuste' && dados.sentido === 'credito' ? -1 : 1
    const centavos = paraCentavos(dados.valor)
    if (dados.tipo !== 'compra' && dados.parcelas !== 1) throw requisicaoInvalida('Estornos e ajustes não podem ser parcelados.')
    if (centavos < dados.parcelas) throw requisicaoInvalida('O valor é pequeno demais para esse número de parcelas.')
    const agenda = montarAgenda({
      data: dados.data,
      totalCentavos: centavos * sinal,
      parcelas: dados.parcelas,
      diaFechamento: cartao.diaFechamento,
      diaVencimento: cartao.diaVencimento
    })
    return {
      kind: TIPO_SQL[dados.tipo],
      total: centavosParaDecimal(centavos * sinal),
      itens: agenda.itens.map((i) => ({
        numero: i.numero,
        valor: centavosParaDecimal(i.centavos),
        competencia: i.competencia,
        ref_month: i.mesRef
      })),
      ciclos: agenda.ciclos.map((c) => ({
        ref_month: c.mesRef,
        period_start: c.inicio,
        closing_date: c.fechamento,
        due_date: c.vencimento
      }))
    }
  }

  /* ---------- Cartões ---------- */

  router.get('/', assincrono(async (req, res) => {
    res.json({ cartoes: await cartoes.listarCartoes(req.usuario.id) })
  }))

  router.post('/', assincrono(async (req, res) => {
    const dados = validar(zCartao, req.body)
    if ((await cartoes.contarCartoes(req.usuario.id)) >= LIMITE_CARTOES) {
      throw requisicaoInvalida(`Limite de ${LIMITE_CARTOES} cartões atingido.`)
    }
    res.status(201).json({ cartao: await cartoes.criarCartao(req.usuario.id, dados) })
  }))

  // Desativar = `ativo: false`: o histórico e as faturas em aberto continuam, só não aceita novas compras.
  router.patch('/:id', assincrono(async (req, res) => {
    const cartao = await cartoes.atualizarCartao(req.usuario.id, uuidDaRota(req.params.id), validar(zCartaoAtualizar, req.body))
    if (!cartao) throw naoEncontrado('Cartão não encontrado.')
    res.json({ cartao })
  }))

  /* ---------- Painel: cartões + resumo das faturas ---------- */

  router.get('/painel', assincrono(async (req, res) => {
    const userId = req.usuario.id
    const hoje = hojeDe(req.usuario)
    const [lista, faturasBase, pagoNoMes] = await Promise.all([
      cartoes.listarCartoes(userId),
      cartoes.listarFaturas(userId, { relevantesDesde: hoje }),
      cartoes.pagoNoMes(userId, hoje.slice(0, 7))
    ])
    const faturas = faturasBase.map((f) => comStatus(f, hoje))

    // Fatura em andamento de cada cartão (a que recebe as compras de hoje), mesmo que ainda não exista no banco.
    const cartoesComFatura = lista.map((c) => {
      const mesRef = mesDaFatura(hoje, c.diaFechamento)
      const existente = faturas.find((f) => f.cartaoId === c.id && f.mesRef === mesRef)
      const ciclo = cicloDaFatura(mesRef, c.diaFechamento, c.diaVencimento)
      const faturaAtual = existente ?? comStatus(
        { id: null, cartaoId: c.id, cartaoNome: c.nome, mesRef, inicio: ciclo.inicio, fechamento: ciclo.fechamento, vencimento: ciclo.vencimento, total: 0, pago: 0, pendente: 0 },
        hoje
      )
      return { ...c, faturaAtual }
    })

    const aPagar = faturas.filter((f) => f.pendente > 0)
    const proxima = [...aPagar].sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0] ?? null
    const ativos = lista.filter((c) => c.ativo)
    res.json({
      hoje,
      cartoes: cartoesComFatura,
      totais: {
        limiteTotal: arredondar(ativos.reduce((s, c) => s + c.limite, 0)),
        usado: arredondar(ativos.reduce((s, c) => s + c.usado, 0)),
        disponivel: arredondar(ativos.reduce((s, c) => s + c.disponivel, 0)),
        aPagar: arredondar(aPagar.reduce((s, f) => s + f.pendente, 0)),
        vencidas: aPagar.filter((f) => f.status === 'vencida').length,
        pagoNoMes,
        proximoVencimento: proxima && {
          faturaId: proxima.id,
          cartaoId: proxima.cartaoId,
          cartaoNome: proxima.cartaoNome,
          vencimento: proxima.vencimento,
          pendente: proxima.pendente,
          status: proxima.status
        }
      }
    })
  }))

  /* ---------- Faturas ---------- */

  router.get('/faturas', assincrono(async (req, res) => {
    const f = validar(zConsultaFaturas, req.query)
    const hoje = hojeDe(req.usuario)
    const lista = (await cartoes.listarFaturas(req.usuario.id, { cartaoId: f.cartao, de: f.de, ate: f.ate }))
      .map((x) => comStatus(x, hoje))
      .filter((x) => !f.status || x.status === f.status)
      // Faturas vazias só aparecem se ainda estiverem em andamento (não há o que mostrar de uma fatura sem lançamentos).
      .filter((x) => x.total !== 0 || x.pago !== 0)
    res.json({ hoje, faturas: lista })
  }))

  router.get('/faturas/:id', assincrono(async (req, res) => {
    const userId = req.usuario.id
    const id = uuidDaRota(req.params.id)
    const fatura = await cartoes.obterFatura(userId, id)
    if (!fatura) throw naoEncontrado('Fatura não encontrada.')
    const [lancamentos, pagamentos] = await Promise.all([cartoes.lancamentosDaFatura(userId, id), cartoes.pagamentosDaFatura(userId, id)])
    res.json({ fatura: comStatus(fatura, hojeDe(req.usuario)), lancamentos, pagamentos })
  }))

  /* ---------- Lançamentos e consumo ---------- */

  router.get('/lancamentos', assincrono(async (req, res) => {
    const f = validar(zConsultaLancamentos, req.query)
    const hoje = hojeDe(req.usuario)
    const lista = (await cartoes.listarLancamentos(req.usuario.id, { cartaoId: f.cartao, de: f.de, ate: f.ate, limite: f.limite }))
      .map((l) => ({
        ...l,
        statusFatura: statusDaFatura({ total: l.faturaTotal, pago: l.faturaPago, fechamento: l.fechamento, vencimento: l.vencimento, hoje })
      }))
      .filter((l) => !f.status || l.statusFatura === f.status)
    res.json({ lancamentos: lista })
  }))

  // Consumo do cartão como despesas do Financeiro (uma por parcela, no mês dela). O pagamento da fatura NÃO
  // aparece aqui: ele é saída de caixa, e contar os dois seria contar a mesma despesa duas vezes.
  router.get('/consumo', assincrono(async (req, res) => {
    const f = validar(z.object({ de: zData.optional(), ate: zData.optional() }), req.query)
    res.json({ consumo: await cartoes.consumo(req.usuario.id, f) })
  }))

  /* ---------- Compras ---------- */

  router.post('/compras', assincrono(async (req, res) => {
    const userId = req.usuario.id
    const dados = validar(zCompra, req.body)
    const cartao = await cartaoDoUsuario(userId, dados.cartaoId)
    if (!cartao.ativo) throw requisicaoInvalida('Este cartão está desativado. Ative-o para registrar compras.')

    const plano = planejar(dados, cartao)
    const id = randomUUID()
    const r = await cartoes.criarCompra(userId, {
      id, cartaoId: cartao.id, kind: plano.kind, descricao: dados.descricao, categoria: dados.categoria,
      total: plano.total, parcelas: dados.parcelas, data: dados.data, chave: dados.chave, ciclos: plano.ciclos, itens: plano.itens
    })
    if (!r.criada) {
      // Mesmo envio repetido (clique duplo, nova tentativa): devolve a compra já registrada.
      const existente = dados.chave && (await cartoes.compraPorChave(userId, dados.chave))
      if (existente) return res.status(200).json({ compraId: existente, repetida: true })
      throw conflito('Não foi possível registrar a compra agora. Tente novamente.')
    }
    res.status(201).json({ compraId: id })
  }))

  router.patch('/compras/:id', assincrono(async (req, res) => {
    const userId = req.usuario.id
    const id = uuidDaRota(req.params.id)
    const compra = await cartoes.obterCompra(userId, id)
    if (!compra) throw naoEncontrado('Lançamento não encontrado.')
    const mudancas = validar(zCompraAtualizar, req.body)

    // Só texto (descrição/categoria): sempre permitido, não mexe em parcelas nem faturas.
    const chavesFinanceiras = ['cartaoId', 'tipo', 'sentido', 'valor', 'parcelas', 'data']
    if (!chavesFinanceiras.some((k) => k in mudancas)) {
      await cartoes.atualizarTextoDaCompra(userId, id, { descricao: mudancas.descricao, categoria: mudancas.categoria })
      return res.json({ ok: true })
    }

    const tipoAtual = compra.kind === 'purchase' ? 'compra' : compra.kind === 'refund' ? 'estorno' : 'ajuste'
    const total = Number(compra.total_amount)
    const dados = {
      cartaoId: mudancas.cartaoId ?? compra.card_id,
      tipo: mudancas.tipo ?? tipoAtual,
      sentido: mudancas.sentido ?? (total < 0 ? 'credito' : 'cobranca'),
      descricao: mudancas.descricao ?? compra.description,
      categoria: mudancas.categoria ?? compra.category,
      valor: mudancas.valor ?? Math.abs(total),
      parcelas: mudancas.parcelas ?? compra.installments,
      data: mudancas.data ?? compra.purchase_date
    }
    const cartao = await cartaoDoUsuario(userId, dados.cartaoId)
    if (!cartao.ativo && cartao.id !== compra.card_id) throw requisicaoInvalida('Este cartão está desativado.')

    if (await cartoes.compraTemPagamentos(userId, id)) {
      throw conflito('Há pagamentos em faturas desta compra. Remova os pagamentos antes de alterar valor, parcelas, data ou cartão.')
    }
    const plano = planejar(dados, cartao)
    const r = await cartoes.refazerCompra(userId, {
      id, cartaoId: cartao.id, kind: plano.kind, descricao: dados.descricao, categoria: dados.categoria,
      total: plano.total, parcelas: dados.parcelas, data: dados.data, ciclos: plano.ciclos, itens: plano.itens
    })
    if (!r.atualizada) {
      if (r.bloqueada) throw conflito('Há pagamentos em faturas desta compra. Remova os pagamentos antes de alterar.')
      throw conflito('Não foi possível alterar a compra agora. Tente novamente.')
    }
    res.json({ ok: true })
  }))

  router.delete('/compras/:id', assincrono(async (req, res) => {
    const userId = req.usuario.id
    const id = uuidDaRota(req.params.id)
    if (!(await cartoes.obterCompra(userId, id))) throw naoEncontrado('Lançamento não encontrado.')
    if (!(await cartoes.excluirCompra(userId, id))) {
      throw conflito('Há pagamentos em faturas desta compra. Remova os pagamentos antes de excluir.')
    }
    res.status(204).end()
  }))

  /* ---------- Pagamentos de fatura ---------- */

  router.post('/pagamentos', assincrono(async (req, res) => {
    const userId = req.usuario.id
    const dados = validar(zPagamento, req.body)
    const r = await cartoes.registrarPagamento(userId, dados)
    if (!r.existe) throw naoEncontrado('Fatura não encontrada.')
    if (!r.id) {
      const repetido = dados.chave && (await cartoes.pagamentoPorChave(userId, dados.chave))
      if (repetido) return res.status(200).json({ pagamentoId: repetido.id, repetido: true })
      throw requisicaoInvalida('O valor é maior que o saldo pendente da fatura.')
    }
    res.status(201).json({ pagamentoId: r.id })
  }))

  router.delete('/pagamentos/:id', assincrono(async (req, res) => {
    if (!(await cartoes.excluirPagamento(req.usuario.id, uuidDaRota(req.params.id)))) throw naoEncontrado('Pagamento não encontrado.')
    res.status(204).end()
  }))

  return router
}
