'use server'

import { revalidatePath } from 'next/cache'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import { leadSchema } from '@/lib/domain/lead'
import { normalizarEmail, normalizarTelefone } from '@/lib/domain/normalizacao'
import { parsearReaisEmCentavos } from '@/lib/domain/formato'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'

export type Duplicado = { id: string; nome: string; status: string }

export async function verificarDuplicados(
  telefone: string,
  email: string,
): Promise<Resultado<Duplicado[]>> {
  const contexto = await criarStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)

  const r = await contexto.valor.store.possiveisDuplicados(
    normalizarTelefone(telefone),
    normalizarEmail(email),
  )
  if (!r.ok) return falha(r.erro)
  return ok(r.valor.map((l) => ({ id: l.id, nome: l.nome, status: l.status })))
}

export async function criarLeadAction(formData: FormData): Promise<Resultado<string>> {
  const contexto = await criarStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)
  const { store, usuarioId, papel } = contexto.valor

  const valorTexto = String(formData.get('valor') ?? '').trim()
  let valorCents: number | null = null
  if (valorTexto) {
    valorCents = parsearReaisEmCentavos(valorTexto)
    if (valorCents === null) return falha('valor_invalido')
  }

  const parsed = leadSchema.safeParse({
    nome: formData.get('nome'),
    telefone: formData.get('telefone'),
    email: formData.get('email'),
    empresa: formData.get('empresa'),
    valorCents,
    // Vendedor so cria lead para si; gestor e admin escolhem o responsavel.
    responsavelId:
      papel === 'vendedor' ? usuarioId : (formData.get('responsavelId') as string) || null,
  })
  if (!parsed.success) return falha(parsed.error.issues[0].message)

  const pipeline = await store.pipelinePadrao()
  if (!pipeline.ok) return falha(pipeline.erro)
  const primeira = pipeline.valor.etapas.find((e) => e.tipo === 'aberta')
  if (!primeira) return falha('pipeline_sem_etapa_aberta')

  const r = await store.criarLead({
    ...parsed.data,
    pipelineId: pipeline.valor.pipeline.id,
    stageId: primeira.id,
  })
  if (!r.ok) return falha(r.erro)

  revalidatePath('/funil')
  return ok(r.valor)
}

export async function moverEtapaAction(
  leadId: string,
  stageDestino: string,
  lossReasonId: string | null,
  etiquetas: string[],
): Promise<Resultado<void>> {
  const contexto = await criarStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)
  const { store } = contexto.valor

  // Etiquetas primeiro: o snapshot precisa gravar a etapa de ORIGEM, que e onde
  // a qualificacao aconteceu. Depois de mover, o snapshot registraria o destino.
  let etiquetasSalvas = false
  if (etiquetas.length > 0) {
    const r = await store.aplicarEtiquetas(leadId, etiquetas)
    if (!r.ok) return falha(r.erro)
    etiquetasSalvas = true
  }

  const r = await store.moverEtapa(leadId, stageDestino, lossReasonId)
  if (!r.ok) {
    // Sem transacao cobrindo as duas chamadas: as etiquetas ja estao gravadas.
    // Devolvemos um codigo proprio para a UI contar isso em vez de dizer que
    // nada aconteceu. Repetir e seguro: aplicarEtiquetas ignora duplicadas e
    // rele a etapa atual antes de gravar o snapshot.
    if (etiquetasSalvas) return falha('movimento_falhou_etiquetas_salvas')
    return falha(r.erro)
  }

  revalidatePath('/funil')
  return ok(undefined)
}
