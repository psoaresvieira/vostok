'use server'

import { revalidatePath } from 'next/cache'
import { criarAdminStoreDoServidor } from '@/lib/data/admin'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import type { Papel, StageTipo } from '@/lib/domain/tipos'

export async function criarEtapaAction(nome: string, tipo: StageTipo): Promise<Resultado<void>> {
  const contexto = await criarAdminStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)
  const limpo = nome.trim()
  if (!limpo) return falha('nome_obrigatorio')

  const r = await contexto.valor.admin.criarEtapa(limpo, tipo)
  if (!r.ok) return falha(r.erro)
  revalidatePath('/config')
  revalidatePath('/funil')
  return ok(undefined)
}

export async function renomearEtapaAction(etapaId: string, nome: string): Promise<Resultado<void>> {
  const contexto = await criarAdminStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)
  const limpo = nome.trim()
  if (!limpo) return falha('nome_obrigatorio')

  const r = await contexto.valor.admin.renomearEtapa(etapaId, limpo)
  if (!r.ok) return falha(r.erro)
  revalidatePath('/config')
  revalidatePath('/funil')
  return ok(undefined)
}

export async function excluirEtapaAction(etapaId: string): Promise<Resultado<void>> {
  const contexto = await criarAdminStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)

  const r = await contexto.valor.admin.excluirEtapa(etapaId)
  if (!r.ok) return falha(r.erro)
  revalidatePath('/config')
  revalidatePath('/funil')
  return ok(undefined)
}

export async function reordenarEtapasAction(idsNaOrdem: string[]): Promise<Resultado<void>> {
  const contexto = await criarAdminStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)

  const r = await contexto.valor.admin.reordenarEtapas(idsNaOrdem)
  if (!r.ok) return falha(r.erro)
  revalidatePath('/config')
  revalidatePath('/funil')
  return ok(undefined)
}

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
