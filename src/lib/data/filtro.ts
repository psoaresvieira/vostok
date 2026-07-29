/**
 * Escape de valores para os filtros textuais do PostgREST.
 *
 * O `.or()` do supabase-js recebe UMA string no formato
 * `coluna.operador.valor,coluna.operador.valor`. Concatenar texto do usuario
 * ali dentro tem duas consequencias distintas, e cada funcao aqui resolve uma:
 *
 * 1. Virgula e ponto sao a pontuacao da propria sintaxe. Envolver o valor em
 *    aspas duplas tira o poder deles — e o que `valorPostgrest` faz.
 * 2. `%` e `_` sao curingas do LIKE. Aspas nao os neutralizam; so o escape do
 *    proprio LIKE neutraliza — e o que `padraoIlike` faz por cima do item 1.
 */

/**
 * Envolve o valor em aspas duplas, escapando o que quebraria as aspas.
 *
 * A ordem importa: a barra invertida vem primeiro, senao o escape das aspas
 * seria escapado de novo no passo seguinte e o resultado teria barra sobrando.
 */
export function valorPostgrest(valor: string): string {
  const escapado = valor.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"${escapado}"`
}

/**
 * Monta o padrao `%texto%` tratando o que o usuario digitou como literal.
 *
 * O `\` que escapa o curinga precisa chegar ao Postgres como um `\` de
 * verdade, e ele atravessa `valorPostgrest`, que dobra barras. Por isso o
 * escape do LIKE usa `\\` aqui: vira `\\\\` na string entre aspas, que o
 * PostgREST desfaz para `\\`, que o LIKE le como "um `\` literal escapando o
 * proximo caractere".
 */
export function padraoIlike(texto: string): string {
  const literal = texto
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
  return valorPostgrest(`%${literal}%`)
}
