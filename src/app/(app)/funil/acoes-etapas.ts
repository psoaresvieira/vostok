'use server'

import { revalidatePath } from 'next/cache'
import { criarEtapaStoreDoServidor } from '@/lib/data/etapas'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import type { StageTipo } from '@/lib/domain/tipos'

// Todas com pipelineId explicito: o EtapaStore e' construido por pipeline, e
// o componente sempre sabe qual esta ativa. Validacao de nome ANTES de tocar
// o store, mesmo padrao de acoes-pipelines.ts — nome vazio nunca chega a
// abrir conexao nenhuma.

export async function criarEtapaAction(
  pipelineId: string,
  nome: string,
  tipo: StageTipo,
): Promise<Resultado<void>> {
  const limpo = nome.trim()
  if (!limpo) return falha('nome_obrigatorio')

  const contexto = await criarEtapaStoreDoServidor(pipelineId)
  if (!contexto.ok) return falha(contexto.erro)

  const r = await contexto.valor.etapas.criarEtapa(limpo, tipo)
  if (!r.ok) return falha(r.erro)

  revalidatePath('/funil')
  return ok(undefined)
}

export async function renomearEtapaAction(
  pipelineId: string,
  etapaId: string,
  nome: string,
): Promise<Resultado<void>> {
  const limpo = nome.trim()
  if (!limpo) return falha('nome_obrigatorio')

  const contexto = await criarEtapaStoreDoServidor(pipelineId)
  if (!contexto.ok) return falha(contexto.erro)

  const r = await contexto.valor.etapas.renomearEtapa(etapaId, limpo)
  if (!r.ok) return falha(r.erro)

  revalidatePath('/funil')
  return ok(undefined)
}

export async function excluirEtapaAction(
  pipelineId: string,
  etapaId: string,
): Promise<Resultado<void>> {
  const contexto = await criarEtapaStoreDoServidor(pipelineId)
  if (!contexto.ok) return falha(contexto.erro)

  const r = await contexto.valor.etapas.excluirEtapa(etapaId)
  if (!r.ok) return falha(r.erro)

  revalidatePath('/funil')
  return ok(undefined)
}

export async function reordenarEtapasAction(
  pipelineId: string,
  idsNaOrdem: string[],
): Promise<Resultado<void>> {
  const contexto = await criarEtapaStoreDoServidor(pipelineId)
  if (!contexto.ok) return falha(contexto.erro)

  const r = await contexto.valor.etapas.reordenarEtapas(idsNaOrdem)
  if (!r.ok) return falha(r.erro)

  revalidatePath('/funil')
  return ok(undefined)
}
