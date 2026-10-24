export function lerCookies(cabecalho) {
  const cookies = {}
  if (!cabecalho) return cookies
  for (const parte of cabecalho.split(';')) {
    const i = parte.indexOf('=')
    if (i < 0) continue
    const nome = parte.slice(0, i).trim()
    const valor = parte.slice(i + 1).trim()
    if (!nome || nome in cookies) continue
    try {
      cookies[nome] = decodeURIComponent(valor)
    } catch {
      /* cookie malformado é ignorado */
    }
  }
  return cookies
}

export function definirCookie(res, nome, valor, { producao, maxAgeSeg, sameSite = 'Lax', httpOnly = true }) {
  const partes = [`${nome}=${encodeURIComponent(valor)}`, 'Path=/', `SameSite=${sameSite}`]
  if (httpOnly) partes.push('HttpOnly')
  if (producao) partes.push('Secure')
  if (maxAgeSeg !== undefined) partes.push(`Max-Age=${Math.floor(maxAgeSeg)}`)
  res.append('Set-Cookie', partes.join('; '))
}

export function limparCookie(res, nome, { producao, sameSite = 'Lax' }) {
  const partes = [`${nome}=`, 'Path=/', `SameSite=${sameSite}`, 'HttpOnly', 'Max-Age=0', 'Expires=Thu, 01 Jan 1970 00:00:00 GMT']
  if (producao) partes.push('Secure')
  res.append('Set-Cookie', partes.join('; '))
}
