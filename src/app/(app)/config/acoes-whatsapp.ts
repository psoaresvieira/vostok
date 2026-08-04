'use server'

import { revalidatePath } from 'next/cache'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import { criarWhatsAppStoreDoServidor } from '@/lib/data/whatsapp'
import { whatsappGraph } from '@/lib/integracoes/fabrica'

/**
 * Ordem normativa (task-3-brief.md): (1) resolve o store (admin); (2) trim
 * nos tres campos, algum vazio falha antes de qualquer IO; (3)
 * INGESTAO_SEGREDO ausente falha antes de tocar o Graph — mesmo achado da
 * Task 10 em acoes-fontes.ts:107, para nao validar contra o Graph num deploy
 * que vai falhar na gravacao de qualquer jeito; (4) dadosDoNumero contra o
 * Graph, forward do codigo do port em falha; (5) store.conectar com
 * numeroExibicao/nomeVerificado DA RESPOSTA DO GRAPH, nunca do formulario;
 * (6) revalidatePath.
 */
export async function conectarWhatsAppAction(d: {
  token: string
  phoneNumberId: string
  wabaId: string
}): Promise<Resultado<void>> {
  const contexto = await criarWhatsAppStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)

  const token = d.token.trim()
  const phoneNumberId = d.phoneNumberId.trim()
  const wabaId = d.wabaId.trim()
  if (!token || !phoneNumberId || !wabaId) return falha('whatsapp_campos_vazios')

  if ((process.env.INGESTAO_SEGREDO ?? '').length === 0) return falha('ingestao_nao_configurada')

  const dados = await whatsappGraph().dadosDoNumero(token, phoneNumberId)
  if (!dados.ok) return falha(dados.erro)

  const r = await contexto.valor.whatsapp.conectar({
    phoneNumberId,
    wabaId,
    numeroExibicao: dados.valor.numeroExibicao,
    nomeVerificado: dados.valor.nomeVerificado,
    token,
  })
  if (!r.ok) return falha(r.erro)

  revalidatePath('/config')
  return ok(undefined)
}

export async function desconectarWhatsAppAction(id: string): Promise<Resultado<void>> {
  const contexto = await criarWhatsAppStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)

  const r = await contexto.valor.whatsapp.desconectar(id)
  if (!r.ok) return falha(r.erro)

  revalidatePath('/config')
  return ok(undefined)
}
