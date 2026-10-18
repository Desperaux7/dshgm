// Utilidades de armazenamento local e de datas, compartilhadas entre os módulos.

export function lerJSON(chave, padrao) {
  try {
    const bruto = localStorage.getItem(chave)
    return bruto === null ? padrao : JSON.parse(bruto)
  } catch {
    return padrao
  }
}

// Retorna true/false para o módulo decidir se avisa o usuário.
export function salvarJSON(chave, valor) {
  try {
    localStorage.setItem(chave, JSON.stringify(valor))
    return true
  } catch (erro) {
    console.error(`Erro ao salvar "${chave}":`, erro)
    return false
  }
}

export function novoId() {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/* ---------- Datas (sempre no fuso local, no formato AAAA-MM-DD) ---------- */

export function chaveData(data = new Date()) {
  const mes = String(data.getMonth() + 1).padStart(2, '0')
  const dia = String(data.getDate()).padStart(2, '0')
  return `${data.getFullYear()}-${mes}-${dia}`
}

// Meio-dia evita problemas de horário de verão ao somar dias.
export function dataDeChave(chave) {
  return new Date(`${chave}T12:00:00`)
}

export function somarDias(chave, dias) {
  const data = dataDeChave(chave)
  data.setDate(data.getDate() + dias)
  return chaveData(data)
}

export function formatarDataBR(chave) {
  const [ano, mes, dia] = chave.split('-')
  return `${dia}/${mes}/${ano}`
}

export function escaparHTML(texto) {
  return String(texto).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}
