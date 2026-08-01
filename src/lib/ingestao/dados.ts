/**
 * Forma comum que os mapeadores de Meta e Google convergem antes de chegar em
 * `ingerir_lead`. Um so tipo para os dois provedores e o que deixa a Task 7
 * (rota do Meta) e a Task 8/9 (Google) tratarem o resultado do mapeamento sem
 * saber qual provedor gerou o payload original.
 */
export type DadosDoLead = {
  nome: string | null
  telefone: string | null
  telefoneE164: string | null
  email: string | null
  emailNorm: string | null
  empresa: string | null
  /** Rastreamento de origem, em pares id/nome. A metrica agrupa pelo ID
   * (renomear campanha no gerenciador nao pode partir o historico) e exibe o
   * NOME. Nome nulo e legitimo: o Google nunca manda nome. */
  campanhaId: string | null
  campanhaNome: string | null
  conjuntoId: string | null
  conjuntoNome: string | null
  anuncioId: string | null
  anuncioNome: string | null
  formularioId: string | null
  /** gcl_id do Google. Nao e lido por nada hoje: entra porque chega de graca
   * no payload e e a unica chave que um dia fecha o laco de conversao
   * offline de volta no Google Ads — capturar depois e impossivel. */
  clickId: string | null
  /** Campos que o mapeador nao reconheceu, com o nome original como chave.
   * E o mecanismo que garante que nada e descartado: pergunta de qualificacao
   * que o cliente escreveu no Meta Ads Manager ou no Google Ads nao tem schema
   * fixo, e ainda assim precisa chegar na timeline do lead. */
  extras: Record<string, string>
}

/**
 * Unica traducao de `DadosDoLead` para as chaves snake_case que a RPC
 * `ingerir_lead` le (migration 0011: `p_dados ->> 'telefone_e164'` etc). As
 * Tasks 7, 8 e 9 chamam so esta funcao — se cada rota reimplementasse este
 * mapeamento, uma delas divergiria da RPC em silencio (por exemplo esquecendo
 * o `_norm` de `email_norm`) e o sintoma seria dedup quebrado, nao um erro
 * que aparece em teste.
 */
export function paraPayload(d: DadosDoLead): Record<string, unknown> {
  return {
    nome: d.nome,
    telefone: d.telefone,
    telefone_e164: d.telefoneE164,
    email: d.email,
    email_norm: d.emailNorm,
    empresa: d.empresa,
    campanha_id: d.campanhaId,
    campanha_nome: d.campanhaNome,
    conjunto_id: d.conjuntoId,
    conjunto_nome: d.conjuntoNome,
    anuncio_id: d.anuncioId,
    anuncio_nome: d.anuncioNome,
    formulario_id: d.formularioId,
    click_id: d.clickId,
    extras: d.extras,
  }
}
