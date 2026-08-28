'use server'

import { revalidatePath } from 'next/cache'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import type { CrmStore } from '@/lib/data/store'
import { leadSchema } from '@/lib/domain/lead'
import { normalizarEmail, normalizarTelefone } from '@/lib/domain/normalizacao'
import { parsearReaisEmCentavos } from '@/lib/domain/formato'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import { codigoEtiquetasSalvas } from './erros'

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

  // pipelineId presente: o lead nasce na primeira etapa ABERTA daquela
  // pipeline, nunca da padrao. Pipeline inexistente devolve o codigo do
  // store direto (pipeline_nao_encontrado) — sem fallback silencioso para a
  // padrao, que esconderia do usuario que o id que ele mandou nao existe.
  // Campo ausente: comportamento de sempre, pipeline padrao da conta.
  const pipelineIdBruto = formData.get('pipelineId')
  const pipelineId = typeof pipelineIdBruto === 'string' ? pipelineIdBruto.trim() : ''
  const pipeline = pipelineId
    ? await store.pipelinePorId(pipelineId)
    : await store.pipelinePadrao()
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

/**
 * O miolo comum de moverEtapaAction e moverParaPipelineAction: as duas
 * gravam as etiquetas antes de mover e precisam da mesma rede de seguranca
 * quando o movimento recusa depois. So' o `mover` muda entre elas — deixar
 * as duas com copias do mesmo tratamento faria a proxima correcao valer
 * para uma so'.
 *
 * Nao e' `export`: 'use server' exige que todo export deste arquivo seja uma
 * Server Action, e este helper nao e' um endpoint.
 */
async function moverComEtiquetas(
  store: CrmStore,
  leadId: string,
  etiquetas: string[],
  mover: () => Promise<Resultado<void>>,
): Promise<Resultado<void>> {
  // Etiquetas primeiro: o snapshot precisa gravar a etapa de ORIGEM, que e onde
  // a qualificacao aconteceu. Depois de mover, o snapshot registraria o destino.
  let etiquetasSalvas = false
  if (etiquetas.length > 0) {
    const r = await store.aplicarEtiquetas(leadId, etiquetas)
    if (!r.ok) return falha(r.erro)
    etiquetasSalvas = true
  }

  const r = await mover()
  if (!r.ok) {
    // Sem transacao cobrindo as duas chamadas: as etiquetas ja estao gravadas.
    // Devolvemos um codigo proprio para a UI contar isso em vez de dizer que
    // nada aconteceu. Repetir e seguro: aplicarEtiquetas ignora duplicadas e
    // rele a etapa atual antes de gravar o snapshot.
    if (etiquetasSalvas) {
      // Revalidar ANTES de voltar: senao o banner diz que as etiquetas foram
      // salvas enquanto o cartao na tela continua sem nenhuma — a tela
      // contradizendo a mensagem.
      revalidatePath('/funil')
      // A causa vai junto: 'etapa_invalida' e 'motivo_perda_invalido' nunca
      // passam por repeticao, e mandar "tente de novo" gasta o tempo do usuario
      // e some com o unico diagnostico que havia.
      return falha(codigoEtiquetasSalvas(r.erro))
    }
    return falha(r.erro)
  }

  revalidatePath('/funil')
  return ok(undefined)
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

  return moverComEtiquetas(store, leadId, etiquetas, () =>
    store.moverEtapa(leadId, stageDestino, lossReasonId),
  )
}

/** Mover o lead para uma etapa de OUTRA pipeline. Mesma pipeline devolve
 * `mesma_pipeline` — esse movimento e' moverEtapaAction. */
export async function moverParaPipelineAction(
  leadId: string,
  stageDestino: string,
  lossReasonId: string | null,
  etiquetas: string[],
): Promise<Resultado<void>> {
  const contexto = await criarStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)
  const { store } = contexto.valor

  return moverComEtiquetas(store, leadId, etiquetas, () =>
    store.moverParaPipeline(leadId, stageDestino, lossReasonId),
  )
}
