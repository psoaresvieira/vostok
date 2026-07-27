/**
 * Reduz o telefone a E.164. Numero brasileiro sem codigo do pais recebe +55.
 * Retorna null quando nao da para afirmar que e um telefone.
 */
export function normalizarTelefone(bruto: string | null): string | null {
  if (!bruto) return null
  const jaInternacional = bruto.trim().startsWith('+')
  const digitos = bruto.replace(/\D/g, '')
  if (digitos.length === 0) return null

  if (jaInternacional) {
    return digitos.length >= 8 ? `+${digitos}` : null
  }
  // 10 = fixo com DDD, 11 = celular com DDD
  if (digitos.length === 10 || digitos.length === 11) {
    return `+55${digitos}`
  }
  // 12 ou 13 digitos comecando em 55 ja trazem o codigo do pais
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) {
    return `+${digitos}`
  }
  return null
}

export function normalizarEmail(bruto: string | null): string | null {
  if (!bruto) return null
  const limpo = bruto.trim().toLowerCase()
  if (limpo.length === 0) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpo)) return null
  return limpo
}

/** Apara e colapsa espacos, mas preserva a caixa que o usuario digitou. */
export function normalizarNomeEtiqueta(bruto: string): string {
  return bruto.trim().replace(/\s+/g, ' ')
}
