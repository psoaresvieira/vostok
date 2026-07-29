import { falha, type Resultado } from '@/lib/domain/resultado'

/**
 * Codigo de falha de transporte. Nao vem do servidor: nasce no cliente quando a
 * chamada nem chegou a ter resposta, entao nao ha codigo nenhum para traduzir.
 */
export const FALHA_DE_CONEXAO = 'falha_de_conexao'

/**
 * A mensagem mora junto do codigo porque as telas traduzem erro em quatro
 * convencoes diferentes (funil/erros.ts, config/erros.ts e dois mapas locais).
 * Unificar essas convencoes esta fora do escopo; o que da para nao repetir e o
 * texto desta falha nova, que todas elas passam a poder mostrar.
 */
export const MENSAGEM_FALHA_DE_CONEXAO =
  'Não conseguimos falar com o servidor. Verifique sua conexão e tente de novo.'

/**
 * Toda Server Action deste app devolve Resultado e nunca deixa excecao vazar —
 * mas isso vale para o que acontece DENTRO do servidor. Quando o transporte
 * falha (rede caiu, aba offline, servidor inalcancavel), o fetch que o React
 * faz por baixo rejeita e o `await` lanca no componente. Sem isto a excecao
 * escapa para o error reporting global do React, o setErro nunca roda e a tela
 * fica muda: no quadro, o cartao volta para a coluna de origem sem explicacao.
 *
 * Recebe a promessa ja criada e a aguarda no mesmo tick: nao existe janela para
 * unhandled rejection.
 */
export async function chamarAcao<T>(promessa: Promise<Resultado<T>>): Promise<Resultado<T>> {
  try {
    return await promessa
  } catch {
    return falha(FALHA_DE_CONEXAO)
  }
}
