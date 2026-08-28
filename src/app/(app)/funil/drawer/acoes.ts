'use server'

import { revalidatePath } from 'next/cache'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'

/**
 * A tela que depende destas acoes e' `/funil`: o lead virou o drawer do funil
 * (spec 2026-08-28) e `/leads/<id>` so' redireciona para la. Revalidar a rota
 * antiga nao repintava nada — a nota recem-salva ou a etiqueta removida so
 * apareceriam no proximo carregamento completo.
 */
const TELA_DO_LEAD = '/funil'

export async function adicionarNota(leadId: string, texto: string): Promise<Resultado<void>> {
  const limpo = texto.trim()
  if (limpo.length === 0) return falha('nota_vazia')

  const contexto = await criarStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)

  const r = await contexto.valor.store.registrarNota(leadId, limpo)
  if (!r.ok) return falha(r.erro)

  revalidatePath(TELA_DO_LEAD)
  return ok(undefined)
}

export async function adicionarEtiquetas(
  leadId: string,
  nomes: string[],
): Promise<Resultado<void>> {
  const contexto = await criarStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)

  const r = await contexto.valor.store.aplicarEtiquetas(leadId, nomes)
  if (!r.ok) return falha(r.erro)

  revalidatePath(TELA_DO_LEAD)
  return ok(undefined)
}

export async function removerEtiqueta(leadId: string, tagId: string): Promise<Resultado<void>> {
  const contexto = await criarStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)

  const r = await contexto.valor.store.removerEtiqueta(leadId, tagId)
  if (!r.ok) return falha(r.erro)

  revalidatePath(TELA_DO_LEAD)
  return ok(undefined)
}

export async function trocarResponsavel(
  leadId: string,
  responsavelId: string | null,
): Promise<Resultado<void>> {
  const contexto = await criarStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)
  if (contexto.valor.papel === 'vendedor') return falha('sem_permissao')

  const r = await contexto.valor.store.atribuirResponsavel(leadId, responsavelId)
  if (!r.ok) return falha(r.erro)

  revalidatePath(TELA_DO_LEAD)
  return ok(undefined)
}
