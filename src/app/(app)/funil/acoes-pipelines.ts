'use server'

import { revalidatePath } from 'next/cache'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'

/**
 * `etapas` chega como um unico campo de FormData contendo um array JSON de
 * strings — mesma tecnica de campo composto que outros formularios deste app
 * usam para valores nao triviais (a lista nao cabe em multiplos inputs com
 * `name` fixo, e mudaria de tamanho a cada etapa adicionada/removida na UI).
 * JSON invalido ou ausente vira lista vazia: quem realmente nao mandou nada
 * util cai no mesmo caminho de "zero etapas uteis" mais abaixo.
 */
function etapasDoFormData(bruto: FormDataEntryValue | null): string[] {
  if (typeof bruto !== 'string') return []
  try {
    const parsed = JSON.parse(bruto)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

/**
 * Validacao inteira ANTES de tocar o store: nome vazio ou zero etapas uteis
 * nunca chegam a abrir conexao nenhuma, e muito menos a chamar
 * `store.criarPipeline` — o cadastro so grava algo depois que os dois
 * campos passam.
 */
export async function criarPipelineAction(formData: FormData): Promise<Resultado<string>> {
  const nome = String(formData.get('nome') ?? '').trim()
  const etapasAbertas = etapasDoFormData(formData.get('etapas'))
    .map((etapa) => etapa.trim())
    .filter((etapa) => etapa.length > 0)

  if (nome.length === 0) return falha('nome_obrigatorio')
  if (etapasAbertas.length === 0) return falha('etapas_minimo_uma')

  const contexto = await criarStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)

  const r = await contexto.valor.store.criarPipeline(nome, etapasAbertas)
  if (!r.ok) return falha(r.erro)

  revalidatePath('/funil')
  return ok(r.valor)
}

export async function renomearPipelineAction(
  pipelineId: string,
  nome: string,
): Promise<Resultado<void>> {
  const nomeTrim = nome.trim()
  if (nomeTrim.length === 0) return falha('nome_obrigatorio')

  const contexto = await criarStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)

  const r = await contexto.valor.store.renomearPipeline(pipelineId, nomeTrim)
  if (!r.ok) return falha(r.erro)

  revalidatePath('/funil')
  return ok(undefined)
}

export async function excluirPipelineAction(pipelineId: string): Promise<Resultado<void>> {
  const contexto = await criarStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)

  const r = await contexto.valor.store.excluirPipeline(pipelineId)
  if (!r.ok) return falha(r.erro)

  revalidatePath('/funil')
  return ok(undefined)
}
