import '../styles/main.css'
import '../styles/financeiro.css'

import { icon } from '../modules/icons.js'
import { iniciarShell, mostrarAviso } from '../modules/shell.js'
import { baixarArquivo, gerarRelatorioFinanceiro, nomeArquivoFinanceiro } from '../modules/financeiro-pdf.js'
import { criarSeletorCategoria } from '../modules/seletor-categoria.js'
import { financeiroApi } from '../services/financeiroApi.js'

iniciarShell({ pagina: 'financeiro' })

// Tipos: expense (despesa), income (receita), saving (dinheiro guardado)
const CATEGORIAS = {
  expense: ['Moradia', 'Alimentação', 'Transporte', 'Lazer', 'Outros'],
  income: ['Salário', 'Investimentos', 'Outros'],
  saving: ['Reserva', 'Meta', 'Outros']
}

const ICONES = {
  Moradia: 'home',
  Alimentação: 'utensils',
  Transporte: 'car',
  Lazer: 'gamepad',
  Salário: 'briefcase',
  Investimentos: 'trend-up',
  Reserva: 'piggy',
  Meta: 'target',
  Outros: 'dots'
}

const CORES = {
  Moradia: '#5eead4',
  Alimentação: '#67e8f9',
  Transporte: '#34d399',
  Lazer: '#2a93ad',
  Outros: '#587676'
}

// Categorias criadas pelo usuário ganham uma cor da paleta, sempre a mesma para o mesmo nome.
const PALETA_EXTRA = ['#a7f3d0', '#7dd3fc', '#fcd34d', '#c4b5fd', '#f9a8d4', '#fdba74', '#86efac', '#93c5fd']

function corDaCategoria(nome) {
  if (CORES[nome]) return CORES[nome]
  let hash = 0
  for (const letra of nome.toLowerCase()) hash = (hash * 31 + letra.charCodeAt(0)) >>> 0
  return PALETA_EXTRA[hash % PALETA_EXTRA.length]
}

const iconeDaCategoria = (nome) => ICONES[nome] ?? 'tag'

const normalizar = (texto) =>
  texto.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

const MESES_LONGOS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
]
const MESES_CURTOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

const form = document.querySelector('#transaction-form')
const typeInput = document.querySelector('#transaction-type')
const descriptionInput = document.querySelector('#transaction-description')
const categoryInput = document.querySelector('#transaction-category')
const amountInput = document.querySelector('#transaction-amount')
const dateInput = document.querySelector('#transaction-date')

const balanceElement = document.querySelector('#balance')
const incomeElement = document.querySelector('#income-total')
const expenseElement = document.querySelector('#expense-total')
const savedElement = document.querySelector('#saved-total')
const countElement = document.querySelector('#transaction-count')
const listElement = document.querySelector('#transaction-list')
const categoryChart = document.querySelector('#category-chart')
const categoryPeriod = document.querySelector('#category-period')
const goalChart = document.querySelector('#goal-chart')

const monthSelect = document.querySelector('#filter-month')
const yearSelect = document.querySelector('#filter-year')

const typeButtons = document.querySelectorAll('.segmented [data-type]')
const filterButtons = document.querySelectorAll('.filters [data-filter]')

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL'
})

let activeFilter = 'all'

/* ---------- Utilidades ---------- */

function getToday() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function formatCurrency(value) {
  return currencyFormatter.format(value)
}

function formatDate(date) {
  const [year, month, day] = date.split('-')
  return `${day}/${month}/${year}`
}

function emptyMessage(text) {
  const empty = document.createElement('p')
  empty.className = 'empty-state'
  empty.textContent = text
  return empty
}

dateInput.value = getToday()

/* ---------- Dados da conta (API) ---------- */

let transactions = []
let customCategories = [] // { id, tipo, nome } criadas pelo usuário
let goal = null
let loaded = false
let loadError = ''

function errorText(error) {
  return error?.message || 'Não foi possível concluir a operação. Tente novamente.'
}

async function loadData() {
  try {
    const [list, savedGoal, categories] = await Promise.all([
      financeiroApi.listar(),
      financeiroApi.obterMeta(),
      // Sem as categorias próprias a tela continua útil (as padrão e as já usadas aparecem do mesmo jeito).
      financeiroApi.listarCategorias().catch(() => customCategories)
    ])
    transactions = list
    goal = savedGoal
    customCategories = categories
    loaded = true
    loadError = ''
    fillCategories()
  } catch (error) {
    loadError = `Não foi possível carregar os dados (${errorText(error)}).`
  }
  renderAll()
}

function renderLoading() {
  ;[balanceElement, incomeElement, expenseElement, savedElement].forEach((el) => {
    el.textContent = '—'
    el.classList.remove('is-negative')
  })
  countElement.textContent = ''
  exportButton.disabled = true

  const text = loadError || 'Carregando...'
  categoryChart.replaceChildren(emptyMessage(text))
  goalChart.replaceChildren(emptyMessage(text))
  listElement.replaceChildren(emptyMessage(text))

  if (loadError) {
    const retry = document.createElement('button')
    retry.type = 'button'
    retry.className = 'btn btn-sm'
    retry.textContent = 'Tentar novamente'
    retry.addEventListener('click', loadData)
    listElement.append(retry)
  }
}

/* ---------- Filtro por mês/ano ---------- */

const now = new Date()
const period = {
  year: String(now.getFullYear()),
  month: String(now.getMonth() + 1).padStart(2, '0')
}

function fillPeriodSelects() {
  const years = new Set(
    transactions.map((item) => item.date?.slice(0, 4)).filter(Boolean)
  )
  years.add(String(now.getFullYear()))
  if (period.year !== 'all') years.add(period.year)

  yearSelect.replaceChildren(
    new Option('Todos os anos', 'all'),
    ...[...years].sort().reverse().map((year) => new Option(year, year))
  )
  yearSelect.value = period.year

  monthSelect.replaceChildren(
    new Option('Todos os meses', 'all'),
    ...MESES_LONGOS.map((name, index) => new Option(name, String(index + 1).padStart(2, '0')))
  )
  monthSelect.value = period.year === 'all' ? 'all' : period.month
  monthSelect.disabled = period.year === 'all'
}

monthSelect.addEventListener('change', () => {
  period.month = monthSelect.value
  renderAll()
})

yearSelect.addEventListener('change', () => {
  period.year = yearSelect.value
  if (period.year === 'all') period.month = 'all'
  else if (period.month === 'all') period.month = String(now.getMonth() + 1).padStart(2, '0')
  renderAll()
})

function inPeriod(item) {
  if (typeof item.date !== 'string') return false
  if (period.year === 'all') return true
  if (!item.date.startsWith(`${period.year}-`)) return false
  return period.month === 'all' || item.date.slice(5, 7) === period.month
}

function periodLabel() {
  if (period.year === 'all') return 'Todo o período'
  if (period.month === 'all') return `Ano de ${period.year}`
  return `${MESES_LONGOS[Number(period.month) - 1]} de ${period.year}`
}

/* ---------- Tipo de movimentação e categorias ---------- */

// Padrão + criadas pelo usuário + nomes já usados em movimentações do mesmo tipo (inclusive de categorias
// removidas depois), sem repetir. "Outros" fica sempre por último.
function categoriesFor(type) {
  const base = CATEGORIAS[type] ?? CATEGORIAS.expense
  const seen = new Set(base.map(normalizar))
  const extras = []

  const add = (name) => {
    const key = normalizar(name)
    if (!key || seen.has(key)) return
    seen.add(key)
    extras.push(name)
  }

  customCategories.filter((c) => c.tipo === type).forEach((c) => add(c.nome))
  transactions.filter((t) => t.type === type).forEach((t) => add(t.category))

  extras.sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const last = base.filter((name) => name === 'Outros')
  return [...base.filter((name) => name !== 'Outros'), ...extras, ...last]
}

function fillCategories() {
  const previous = categoryInput.value
  const list = categoriesFor(typeInput.value)

  categoryInput.replaceChildren(...list.map((name) => new Option(name, name)))
  categoryInput.value = list.includes(previous) ? previous : list[0]
  categorySelect?.atualizar()
}

const isCustomCategory = (name) =>
  customCategories.some((c) => c.tipo === typeInput.value && normalizar(c.nome) === normalizar(name))

const categorySelect = criarSeletorCategoria({
  select: categoryInput,
  iconeDe: iconeDaCategoria,
  corDe: corDaCategoria,
  podeRemover: isCustomCategory,
  async aoCriar(name) {
    // Se já existe (padrão ou própria), só seleciona a existente.
    const existing = [...categoryInput.options].find((o) => normalizar(o.value) === normalizar(name))
    if (existing) return existing.value

    const created = await financeiroApi.criarCategoria({ tipo: typeInput.value, nome: name })
    customCategories = [...customCategories.filter((c) => c.id !== created.id), created]
    fillCategories()
    return created.nome
  },
  async aoRemover(name) {
    const target = customCategories.find((c) => c.tipo === typeInput.value && normalizar(c.nome) === normalizar(name))
    if (!target) return
    await financeiroApi.removerCategoria(target.id)
    customCategories = customCategories.filter((c) => c.id !== target.id)
    fillCategories()
  }
})

function setType(type) {
  typeInput.value = type
  typeButtons.forEach((button) =>
    button.setAttribute('aria-pressed', String(button.dataset.type === type))
  )
  fillCategories()
}

typeButtons.forEach((button) =>
  button.addEventListener('click', () => setType(button.dataset.type))
)

/* ---------- Resumo (respeita o período) ---------- */

function sumByType(list, type) {
  return list
    .filter((item) => item.type === type)
    .reduce((total, item) => total + item.amount, 0)
}

function updateSummary(list) {
  const income = sumByType(list, 'income')
  const expenses = sumByType(list, 'expense')
  const saved = sumByType(list, 'saving')
  const balance = income - expenses - saved

  balanceElement.textContent = formatCurrency(balance)
  incomeElement.textContent = formatCurrency(income)
  expenseElement.textContent = formatCurrency(expenses)
  savedElement.textContent = formatCurrency(totalSaved())
  balanceElement.classList.toggle('is-negative', balance < 0)
}

/* ---------- Gráfico: despesas por categoria (rosca) ---------- */

function renderCategoryChart(list) {
  const totals = new Map()

  list
    .filter((item) => item.type === 'expense')
    .forEach((item) =>
      totals.set(item.category, (totals.get(item.category) ?? 0) + item.amount)
    )

  categoryPeriod.textContent = periodLabel()
  categoryChart.replaceChildren()

  if (totals.size === 0) {
    categoryChart.append(emptyMessage('Sem despesas neste período.'))
    return
  }

  const entries = [...totals.entries()].sort((a, b) => b[1] - a[1])
  const total = entries.reduce((sum, [, value]) => sum + value, 0)
  const R = 42
  const C = 2 * Math.PI * R
  let offset = 0

  const arcs = entries
    .map(([name, value]) => {
      const length = (value / total) * C
      const gap = entries.length > 1 ? 2 : 0
      const arc =
        `<circle cx="60" cy="60" r="${R}" fill="none" stroke="${corDaCategoria(name)}" ` +
        `stroke-width="12" stroke-dasharray="${Math.max(length - gap, 0.5)} ${C}" ` +
        `stroke-dashoffset="${-offset}" transform="rotate(-90 60 60)"/>`
      offset += length
      return arc
    })
    .join('')

  const wrapper = document.createElement('div')
  wrapper.className = 'donut'
  wrapper.innerHTML =
    `<svg viewBox="0 0 120 120" role="img" aria-label="Gráfico de despesas por categoria">` +
    `<circle cx="60" cy="60" r="${R}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="12"/>` +
    `${arcs}</svg>` +
    `<div class="donut-center"><span>Total</span><strong></strong></div>`
  wrapper.querySelector('strong').textContent = formatCurrency(total)

  const legend = document.createElement('ul')
  legend.className = 'legend'

  entries.forEach(([name, value]) => {
    const item = document.createElement('li')

    const dot = document.createElement('i')
    dot.className = 'dot'
    dot.style.background = corDaCategoria(name)

    const label = document.createElement('span')
    label.textContent = name

    const percent = document.createElement('b')
    percent.textContent = `${Math.round((value / total) * 100)}%`

    item.title = formatCurrency(value)
    item.append(dot, label, percent)
    legend.append(item)
  })

  categoryChart.append(wrapper, legend)
}

/* ---------- Metas financeiras ---------- */

function totalSaved() {
  // A meta considera tudo o que já foi guardado, independente do filtro de período.
  return sumByType(transactions, 'saving')
}

function monthsUntil(deadline) {
  const [year, month] = deadline.split('-').map(Number)
  const diff = (year - now.getFullYear()) * 12 + (month - (now.getMonth() + 1))
  return diff + 1 // conta o mês atual
}

function deadlineLabel(deadline) {
  const [year, month] = deadline.split('-').map(Number)
  return `${MESES_CURTOS[month - 1]}/${year}`
}

function statRow(colorClass, label, value) {
  const row = document.createElement('div')
  row.className = 'goal-stat'

  const name = document.createElement('dt')
  const dot = document.createElement('i')
  dot.className = `dot ${colorClass}`
  name.append(dot, label)

  const amount = document.createElement('dd')
  amount.textContent = value

  row.append(name, amount)
  return row
}

function renderGoal() {
  const editButton = document.querySelector('#goal-edit')
  goalChart.replaceChildren()

  editButton.innerHTML = icon(goal ? 'pencil' : 'plus')
  editButton.setAttribute('aria-label', goal ? 'Editar meta' : 'Definir meta')
  editButton.title = goal ? 'Editar meta' : 'Definir meta'

  if (!goal) {
    const empty = document.createElement('div')
    empty.className = 'goal-empty'
    empty.innerHTML = `<span class="empty-icon">${icon('target')}</span>`

    const text = document.createElement('p')
    text.textContent =
      'Defina uma meta para acompanhar quanto já foi guardado, quanto falta e quanto guardar por mês.'

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'btn btn-primary'
    button.textContent = 'Definir meta'
    button.addEventListener('click', () => openGoalDialog())

    empty.append(text, button)
    goalChart.append(empty)
    return
  }

  const saved = totalSaved()
  const remaining = Math.max(goal.valor - saved, 0)
  const ratio = Math.min(saved / goal.valor, 1)
  const months = monthsUntil(goal.prazo)

  const R = 42
  const C = 2 * Math.PI * R

  const ring = document.createElement('div')
  ring.className = 'donut goal-ring'
  ring.innerHTML =
    `<svg viewBox="0 0 120 120" role="img" aria-label="Progresso da meta financeira">` +
    `<defs><linearGradient id="g-goal" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="#5eead4"/><stop offset="1" stop-color="#34d399"/></linearGradient></defs>` +
    `<circle cx="60" cy="60" r="${R}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="12"/>` +
    (ratio > 0
      ? `<circle cx="60" cy="60" r="${R}" fill="none" stroke="url(#g-goal)" stroke-width="12" ` +
        `stroke-linecap="round" stroke-dasharray="${Math.max(ratio * C, 0.5)} ${C}" transform="rotate(-90 60 60)"/>`
      : '') +
    `</svg><div class="donut-center"><strong>${Math.floor(ratio * 100)}%</strong><span>da meta</span></div>`

  const stats = document.createElement('dl')
  stats.className = 'goal-stats'
  stats.append(
    statRow('dot-saved', 'Guardado', formatCurrency(saved)),
    statRow('dot-remaining', 'Falta', formatCurrency(remaining)),
    statRow('dot-goal', goal.nome || 'Meta', formatCurrency(goal.valor))
  )

  const top = document.createElement('div')
  top.className = 'goal-top'
  top.append(ring, stats)

  const hint = document.createElement('div')
  hint.className = 'goal-hint'

  const label = document.createElement('span')
  const value = document.createElement('strong')
  const note = document.createElement('small')

  if (remaining === 0) {
    hint.classList.add('is-done')
    label.textContent = 'Meta atingida'
    value.textContent = 'Parabéns!'
    note.textContent = 'Você já guardou o valor planejado.'
  } else if (months < 1) {
    hint.classList.add('is-late')
    label.textContent = 'Prazo encerrado'
    value.textContent = `Faltam ${formatCurrency(remaining)}`
    note.textContent = 'Edite a meta e escolha um novo prazo para recalcular.'
  } else {
    label.textContent = 'Guardar em média'
    value.textContent = `${formatCurrency(remaining / months)} / mês`
    note.textContent =
      `${months} ${months === 1 ? 'mês' : 'meses'} até ${deadlineLabel(goal.prazo)}, contando o mês atual.`
  }

  hint.append(label, value, note)
  goalChart.append(top, hint)
}

/* Pop-up da meta */

const goalDialog = document.querySelector('#goal-dialog')
const goalForm = document.querySelector('#goal-form')
const goalName = document.querySelector('#goal-name')
const goalTarget = document.querySelector('#goal-target')
const goalDeadline = document.querySelector('#goal-deadline')
const goalError = document.querySelector('#goal-error')
const goalDelete = document.querySelector('#goal-delete')

function openGoalDialog() {
  goalError.textContent = ''
  goalDelete.hidden = !goal
  document.querySelector('#goal-dialog-title').textContent = goal ? 'Editar meta' : 'Definir meta'

  goalName.value = goal?.nome ?? ''
  goalTarget.value = goal ? String(goal.valor) : ''

  const fallback = new Date(now.getFullYear(), now.getMonth() + 12, 1)
  goalDeadline.value =
    goal?.prazo ?? `${fallback.getFullYear()}-${String(fallback.getMonth() + 1).padStart(2, '0')}`
  goalDeadline.min = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  goalDialog.showModal()
  goalTarget.focus()
}

document.querySelector('#goal-edit').addEventListener('click', openGoalDialog)
document.querySelector('#goal-cancel').addEventListener('click', () => goalDialog.close())
document.querySelector('#goal-cancel-x').addEventListener('click', () => goalDialog.close())
goalDialog.addEventListener('click', (event) => {
  if (event.target === goalDialog) goalDialog.close()
})

goalForm.addEventListener('submit', async (event) => {
  event.preventDefault()

  const valor = Number(goalTarget.value)
  const prazo = goalDeadline.value

  if (!Number.isFinite(valor) || valor <= 0) {
    goalError.textContent = 'Informe um valor maior que zero.'
    goalTarget.focus()
    return
  }

  if (!/^\d{4}-\d{2}$/.test(prazo) || monthsUntil(prazo) < 1) {
    goalError.textContent = 'Escolha um prazo a partir do mês atual.'
    goalDeadline.focus()
    return
  }

  const next = { nome: goalName.value.trim(), valor: Math.round(valor * 100) / 100, prazo }
  const submit = goalForm.querySelector('[type="submit"]')
  if (submit) submit.disabled = true

  try {
    goal = await financeiroApi.salvarMeta(next)
  } catch (error) {
    goalError.textContent = errorText(error)
    return
  } finally {
    if (submit) submit.disabled = false
  }

  goalDialog.close()
  renderGoal()
})

goalDelete.addEventListener('click', async () => {
  if (!confirm('Remover a meta financeira? O dinheiro guardado continua registrado.')) return

  try {
    await financeiroApi.removerMeta()
  } catch (error) {
    goalError.textContent = errorText(error)
    return
  }

  goal = null
  goalDialog.close()
  renderGoal()
})

/* ---------- Histórico ---------- */

// Movimentações do período já filtradas por tipo e ordenadas (usadas na tela e no PDF).
function getVisible(list) {
  return list
    .filter((item) => activeFilter === 'all' || item.type === activeFilter)
    .sort((a, b) => b.date.localeCompare(a.date))
}

function renderTransactions(list) {
  listElement.replaceChildren()

  const visible = getVisible(list)

  countElement.textContent = `${visible.length} ${visible.length === 1 ? 'registro' : 'registros'}`

  if (visible.length === 0) {
    listElement.appendChild(
      emptyMessage(
        transactions.length === 0
          ? 'Nenhuma movimentação cadastrada.'
          : 'Nenhuma movimentação neste período.'
      )
    )
    return
  }

  visible.forEach((transaction) => {
    const item = document.createElement('article')
    item.className = 'transaction-item'

    const badge = document.createElement('span')
    badge.className = `transaction-icon ${transaction.type}`
    badge.innerHTML = icon(
      transaction.type === 'saving' ? 'piggy' : iconeDaCategoria(transaction.category)
    )

    const info = document.createElement('div')
    info.className = 'transaction-info'

    const title = document.createElement('h3')
    title.textContent = transaction.description

    const details = document.createElement('p')
    details.textContent = `${transaction.category} · ${formatDate(transaction.date)}`

    info.append(title, details)

    const right = document.createElement('div')
    right.className = 'transaction-right'

    const value = document.createElement('span')
    value.className = `transaction-value ${transaction.type}`

    const signal = { income: '+ ', expense: '− ', saving: '' }[transaction.type] ?? ''
    value.textContent = `${signal}${formatCurrency(transaction.amount)}`

    const deleteButton = document.createElement('button')
    deleteButton.className = 'delete-button'
    deleteButton.type = 'button'
    deleteButton.innerHTML = icon('trash')
    deleteButton.title = 'Excluir'
    deleteButton.setAttribute('aria-label', `Excluir ${transaction.description}`)

    deleteButton.addEventListener('click', async () => {
      const confirmed = confirm(`Deseja excluir "${transaction.description}"?`)

      if (!confirmed) return

      deleteButton.disabled = true
      try {
        await financeiroApi.excluir(transaction.id)
      } catch (error) {
        deleteButton.disabled = false
        mostrarAviso(errorText(error))
        return
      }

      transactions = transactions.filter((entry) => entry.id !== transaction.id)
      renderAll()
    })

    right.append(value, deleteButton)
    item.append(badge, info, right)
    listElement.appendChild(item)
  })
}

const exportButton = document.querySelector('#export-pdf')
const FILTER_LABELS = { all: 'Todas', income: 'Receitas', expense: 'Despesas', saving: 'Guardado' }

function updateExportButton(list) {
  const empty = getVisible(list).length === 0
  exportButton.disabled = empty
  exportButton.title = empty ? 'Não há movimentações para exportar neste período' : 'Exportar relatório em PDF'
}

exportButton.addEventListener('click', () => {
  const periodList = transactions.filter(inPeriod)
  const shown = getVisible(periodList)
  if (shown.length === 0) return

  try {
    const blob = gerarRelatorioFinanceiro({
      periodo: periodList,
      exibidas: shown,
      rotuloPeriodo: periodLabel(),
      rotuloFiltro: FILTER_LABELS[activeFilter],
      totalGuardado: totalSaved()
    })
    baixarArquivo(blob, nomeArquivoFinanceiro(period.year, period.month))
    mostrarAviso('PDF gerado')
  } catch (error) {
    console.error('Erro ao gerar PDF:', error)
    alert('Não foi possível gerar o PDF.')
  }
})

function renderAll() {
  fillPeriodSelects()

  if (!loaded) {
    renderLoading()
    return
  }

  const list = transactions.filter(inPeriod)

  updateExportButton(list)
  updateSummary(list)
  renderCategoryChart(list)
  renderTransactions(list)
  renderGoal()
}

filterButtons.forEach((button) =>
  button.addEventListener('click', () => {
    activeFilter = button.dataset.filter
    filterButtons.forEach((b) =>
      b.setAttribute('aria-pressed', String(b === button))
    )
    renderAll()
  })
)

form.addEventListener('submit', async (event) => {
  event.preventDefault()

  const description = descriptionInput.value.trim()
  const amount = Number(amountInput.value)
  const date = dateInput.value

  if (!description || !Number.isFinite(amount) || amount <= 0 || !date) {
    alert('Preencha todos os campos com valores válidos.')
    return
  }

  const submit = form.querySelector('[type="submit"]')
  if (submit) submit.disabled = true // evita envio duplo enquanto a API responde

  let transaction
  try {
    transaction = await financeiroApi.criar({
      type: typeInput.value,
      description,
      category: categoryInput.value,
      amount: Math.round(amount * 100) / 100,
      date
    })
  } catch (error) {
    mostrarAviso(errorText(error))
    return
  } finally {
    if (submit) submit.disabled = false
  }

  transactions.push(transaction)

  // Se a data registrada está fora do período filtrado, mostra o período dela.
  if (!inPeriod(transaction)) {
    period.year = date.slice(0, 4)
    period.month = date.slice(5, 7)
  }

  const type = typeInput.value
  form.reset()
  dateInput.value = getToday()
  setType(type)

  renderAll()
  descriptionInput.focus()
})

// Ao voltar para a aba, traz alterações feitas em outro dispositivo ou aba.
document.addEventListener('visibilitychange', async () => {
  if (document.hidden || !loaded) return
  try {
    const [list, savedGoal, categories] = await Promise.all([
      financeiroApi.listar(),
      financeiroApi.obterMeta(),
      financeiroApi.listarCategorias().catch(() => customCategories)
    ])
    transactions = list
    goal = savedGoal
    customCategories = categories
    fillCategories()
    renderAll()
  } catch {
    /* mantém o que já está na tela */
  }
})

setType('expense')
renderAll()
loadData()
