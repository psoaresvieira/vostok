'use server'

import { falha, type Resultado } from '@/lib/domain/resultado'
import { criarNotificacaoStoreDoServidor } from '@/lib/data/notificacoes'

/**
 * Sem revalidatePath aqui de proposito: quem chama estas acoes e sempre o
 * proprio sino, no mesmo request de quem marcou — ele mesmo dispara
 * router.refresh() depois de ok(), que ja busca o layout de novo (a
 * contagem e a lista vem do server component em layout.tsx). revalidatePath
 * invalidaria o cache do Next para OUTROS usuarios navegarem, o que nao faz
 * sentido para um dado que so o dono da notificacao pode ver (RLS).
 */

export async function marcarNotificacaoLidaAction(id: string): Promise<Resultado<void>> {
  const contexto = await criarNotificacaoStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)
  return contexto.valor.marcarLida(id)
}

export async function marcarTodasNotificacoesLidasAction(): Promise<Resultado<void>> {
  const contexto = await criarNotificacaoStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)
  return contexto.valor.marcarTodasLidas()
}
