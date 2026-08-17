'use server'

import { revalidatePath } from 'next/cache'
import { criarAdminStoreDoServidor } from '@/lib/data/admin'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import type { Papel } from '@/lib/domain/tipos'

// As quatro actions de etapa (criar/renomear/excluir/reordenar) sairam
// daqui na Task 2 do Plano 15 — o AdminStore nao tem mais os metodos de
// etapa (foram para SupabaseEtapaStore, por pipeline). As actions novas,
// com pipelineId explicito, nascem em funil/acoes-etapas.ts na Task 3.

export async function criarMotivoAction(nome: string): Promise<Resultado<void>> {
  const contexto = await criarAdminStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)
  const limpo = nome.trim()
  if (!limpo) return falha('nome_obrigatorio')

  const r = await contexto.valor.admin.criarMotivo(limpo)
  if (!r.ok) return falha(r.erro)
  revalidatePath('/config')
  return ok(undefined)
}

export async function alternarMotivoAction(
  motivoId: string,
  ativo: boolean,
): Promise<Resultado<void>> {
  const contexto = await criarAdminStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)

  const r = await contexto.valor.admin.alternarMotivo(motivoId, ativo)
  if (!r.ok) return falha(r.erro)
  revalidatePath('/config')
  return ok(undefined)
}

export async function convidarAction(email: string, papel: Papel): Promise<Resultado<string>> {
  const contexto = await criarAdminStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)
  const limpo = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpo)) return falha('email_invalido')

  const r = await contexto.valor.admin.convidar(limpo, papel)
  if (!r.ok) return falha(r.erro)
  revalidatePath('/config')
  return ok(r.valor)
}

export async function revogarConviteAction(conviteId: string): Promise<Resultado<void>> {
  const contexto = await criarAdminStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)

  const r = await contexto.valor.admin.revogarConvite(conviteId)
  if (!r.ok) return falha(r.erro)
  revalidatePath('/config')
  return ok(undefined)
}
