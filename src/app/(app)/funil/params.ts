/**
 * Monta um href de `/funil` a partir de `queryAtual` (searchParams atuais,
 * ja serializados por quem monta a pagina) aplicando `mudancas` — nunca
 * reconstruindo a URL do zero. Cada chave de `mudancas` com valor string e'
 * setada; com `null`, e' removida. As demais chaves de `queryAtual`
 * (origem, busca, dias, responsavel, pipeline...) sao preservadas.
 *
 * Generaliza `hrefDoItem` de `barra-pipelines.tsx`, que so' sabia mexer na
 * chave `pipeline`. `Drawer` do lead (Task 4) e o seletor de etapa (Task 5)
 * precisam da mesma logica para outras chaves (`lead`, por exemplo).
 */
export function hrefDoFunil(queryAtual: string, mudancas: Record<string, string | null>): string {
  const params = new URLSearchParams(queryAtual)
  for (const [chave, valor] of Object.entries(mudancas)) {
    if (valor === null) params.delete(chave)
    else params.set(chave, valor)
  }
  const query = params.toString()
  return query ? `/funil?${query}` : '/funil'
}
