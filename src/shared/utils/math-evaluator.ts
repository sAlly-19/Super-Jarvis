/**
 * Avaliador de expressões matemáticas seguro e determinístico (sem eval/Function)
 */
export function evaluateMathExpression(expr: string): number {
  let pos = 0
  const clean = expr.trim()

  function peek(): string {
    return clean[pos] || ''
  }

  function get(): string {
    return clean[pos++] || ''
  }

  function skipWhitespace(): void {
    while (pos < clean.length && /\s/.test(clean[pos])) {
      pos++
    }
  }

  function parsePrimary(): number {
    skipWhitespace()
    const ch = peek()

    if (ch === '+') {
      get()
      return parsePrimary()
    }
    if (ch === '-') {
      get()
      return -parsePrimary()
    }

    if (ch === '(') {
      get()
      const val = parseExpression()
      skipWhitespace()
      if (get() !== ')') {
        throw new Error('Parêntese de fechamento esperado')
      }
      return val
    }

    // Identificadores (funções ou constantes)
    if (/[a-zA-Z]/.test(ch)) {
      let name = ''
      while (pos < clean.length && /[a-zA-Z0-9]/.test(peek())) {
        name += get()
      }
      name = name.toLowerCase()

      if (name === 'pi') return Math.PI
      if (name === 'e') return Math.E

      skipWhitespace()
      if (peek() === '(') {
        get()
        const arg = parseExpression()
        skipWhitespace()
        if (get() !== ')') {
          throw new Error(`Parêntese de fechamento esperado na função ${name}`)
        }
        switch (name) {
          case 'sqrt': return Math.sqrt(arg)
          case 'sin': return Math.sin(arg)
          case 'cos': return Math.cos(arg)
          case 'tan': return Math.tan(arg)
          case 'abs': return Math.abs(arg)
          case 'round': return Math.round(arg)
          case 'floor': return Math.floor(arg)
          case 'ceil': return Math.ceil(arg)
          case 'log': return Math.log(arg)
          case 'exp': return Math.exp(arg)
          default:
            throw new Error(`Função matemática desconhecida: ${name}`)
        }
      }
      throw new Error(`Identificador desconhecido: ${name}`)
    }

    // Números (inteiros e decimais)
    if (/[0-9.]/.test(ch)) {
      let numStr = ''
      let hasDot = false
      while (pos < clean.length && (/[0-9]/.test(peek()) || (peek() === '.' && !hasDot))) {
        if (peek() === '.') hasDot = true
        numStr += get()
      }
      const num = parseFloat(numStr)
      if (isNaN(num)) throw new Error(`Número inválido: ${numStr}`)
      return num
    }

    throw new Error(`Caractere inesperado: "${ch}"`)
  }

  function parsePower(): number {
    const base = parsePrimary()
    skipWhitespace()
    if (peek() === '^') {
      get()
      const exponent = parsePower()
      return Math.pow(base, exponent)
    }
    return base
  }

  function parseTerm(): number {
    let val = parsePower()
    skipWhitespace()
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = get()
      const next = parsePower()
      if (op === '*') val *= next
      else if (op === '/') {
        if (next === 0) throw new Error('Divisão por zero')
        val /= next
      }
      else if (op === '%') val %= next
      skipWhitespace()
    }
    return val
  }

  function parseExpression(): number {
    let val = parseTerm()
    skipWhitespace()
    while (peek() === '+' || peek() === '-') {
      const op = get()
      const next = parseTerm()
      if (op === '+') val += next
      else if (op === '-') val -= next
      skipWhitespace()
    }
    return val
  }

  const result = parseExpression()
  skipWhitespace()
  if (pos < clean.length) {
    throw new Error(`Expressão incompleta na posição ${pos}`)
  }
  return result
}

