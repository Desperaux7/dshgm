// Regras de ciclo, fatura e parcelas do cartão de crédito. Funções puras (sem banco, sem relógio):
// as datas são strings AAAA-MM-DD e os valores são inteiros em centavos, para não haver erro de ponto flutuante.

const pad = (n) => String(n).padStart(2, '0')

export const diasNoMes = (ano, mes) => new Date(Date.UTC(ano, mes, 0)).getUTCDate() // mes: 1-12
const dataISO = (a, m, d) => `${a}-${pad(m)}-${pad(d)}`
const partesDoMes = (mesRef) => mesRef.split('-').map(Number)

export function somarDias(data, dias) {
  const [a, m, d] = data.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10)
}

// '2026-11' + 3 -> '2027-02'
export function somarMeses(mesRef, n) {
  const [a, m] = partesDoMes(mesRef)
  const indice = a * 12 + (m - 1) + n
  return `${Math.floor(indice / 12)}-${pad((indice % 12) + 1)}`
}

// Mesmo dia N meses depois; em meses mais curtos vale o último dia (31/01 + 1 mês = 28/02).
export function somarMesesNaData(data, n) {
  const [a, m, d] = data.split('-').map(Number)
  const [ano, mes] = partesDoMes(somarMeses(`${a}-${pad(m)}`, n))
  return dataISO(ano, mes, Math.min(d, diasNoMes(ano, mes)))
}

// Dia de fechamento do mês (dia 31 em fevereiro fecha no último dia de fevereiro).
export function dataDeFechamento(mesRef, diaFechamento) {
  const [a, m] = partesDoMes(mesRef)
  return dataISO(a, m, Math.min(diaFechamento, diasNoMes(a, m)))
}

// Primeiro vencimento DEPOIS do fechamento: no mesmo mês se o dia de vencimento vem depois do fechamento,
// senão no mês seguinte.
export function dataDeVencimento(mesRef, diaFechamento, diaVencimento) {
  const fechamento = dataDeFechamento(mesRef, diaFechamento)
  const [a, m] = partesDoMes(mesRef)
  const mesmoMes = dataISO(a, m, Math.min(diaVencimento, diasNoMes(a, m)))
  if (mesmoMes > fechamento) return mesmoMes
  const [a2, m2] = partesDoMes(somarMeses(mesRef, 1))
  return dataISO(a2, m2, Math.min(diaVencimento, diasNoMes(a2, m2)))
}

// A fatura de mês de referência M cobre do dia seguinte ao fechamento anterior até o fechamento de M (inclusive).
export function cicloDaFatura(mesRef, diaFechamento, diaVencimento) {
  const anterior = dataDeFechamento(somarMeses(mesRef, -1), diaFechamento)
  return {
    mesRef,
    inicio: somarDias(anterior, 1),
    fechamento: dataDeFechamento(mesRef, diaFechamento),
    vencimento: dataDeVencimento(mesRef, diaFechamento, diaVencimento)
  }
}

// Fatura em que uma compra cai: a primeira cujo fechamento ainda não passou (compra no dia do fechamento entra nela).
export function mesDaFatura(data, diaFechamento) {
  const mes = data.slice(0, 7)
  return data > dataDeFechamento(mes, diaFechamento) ? somarMeses(mes, 1) : mes
}

// Divide em n parcelas; o arredondamento sobra para a ÚLTIMA (100,00 em 3 = 33,33 + 33,33 + 33,34).
export function dividirEmParcelas(totalCentavos, n) {
  const sinal = totalCentavos < 0 ? -1 : 1
  const total = Math.abs(totalCentavos)
  const base = Math.floor(total / n)
  const parcelas = Array(n).fill(base * sinal)
  parcelas[n - 1] = (total - base * (n - 1)) * sinal
  return parcelas
}

// Calendário completo de uma compra: cada parcela, o mês de consumo e a fatura em que cai.
export function montarAgenda({ data, totalCentavos, parcelas, diaFechamento, diaVencimento }) {
  const primeira = mesDaFatura(data, diaFechamento)
  const itens = dividirEmParcelas(totalCentavos, parcelas).map((centavos, i) => ({
    numero: i + 1,
    centavos,
    competencia: somarMesesNaData(data, i),
    mesRef: somarMeses(primeira, i)
  }))
  const ciclos = [...new Set(itens.map((i) => i.mesRef))].map((m) => cicloDaFatura(m, diaFechamento, diaVencimento))
  return { itens, ciclos }
}

export const paraCentavos = (valor) => Math.round(valor * 100)
export const centavosParaDecimal = (c) => (c / 100).toFixed(2)

// Status calculado só com datas e valores (sem depender de alguém abrir a tela na data de fechamento).
//   aberta -> ainda recebendo compras | fechada -> aguardando pagamento | parcialmente_paga | paga | vencida
export function statusDaFatura({ total, pago, fechamento, vencimento, hoje }) {
  if (hoje <= fechamento) return 'aberta'
  if (total <= 0 || pago >= total) return 'paga'
  if (hoje > vencimento) return 'vencida'
  return pago > 0 ? 'parcialmente_paga' : 'fechada'
}
