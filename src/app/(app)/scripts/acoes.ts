'use server'

import { revalidatePath } from 'next/cache'
import { criarScriptStoreDoServidor, type DadosScript } from '@/lib/data/scripts'
import { normalizarTags } from '@/lib/domain/script'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import { codigoDoErroDaAcao } from './erros'

/** Quantas tags um script aceita. Validacao com erro, nunca truncamento
 * silencioso: engolir a 11a tag em silencio e' a classe de defeito que a spec
 * §2 decidiu evitar, e por isso normalizarTags (dominio) nao tem limite. O
 * check do banco (0020) e' backstop, nao fluxo. */
const MAX_TAGS = 10

/**
 * Validacao das tres actions, na ordem do brief e ANTES de qualquer IO — mesma
 * forma de criarTarefa (tarefas/acoes.ts): o que da pra recusar sem ir ao
 * servidor e' recusado aqui, com codigo proprio.
 *
 * Devolve os dados ja aparados (titulo/conteudo com trim, tags normalizadas)
 * para que a validacao e a escrita concordem sobre o valor: validar o trim e
 * gravar o cru deixaria passar ' ' como titulo de uma linha.
 */
function validar(d: DadosScript): Resultado<DadosScript> {
  const titulo = d.titulo.trim()
  if (titulo.length === 0) return falha('titulo_vazio')

  const conteudo = d.conteudo.trim()
  if (conteudo.length === 0) return falha('conteudo_vazio')

  const tags = normalizarTags(d.tags)
  if (tags.length > MAX_TAGS) return falha('tags_demais')

  return ok({ titulo, conteudo, stageId: d.stageId, tags })
}

export async function criarScript(d: DadosScript): Promise<Resultado<string>> {
  const dados = validar(d)
  if (!dados.ok) return falha(dados.erro)

  const contexto = await criarScriptStoreDoServidor()
  if (!contexto.ok) return falha(codigoDoErroDaAcao(contexto.erro))

  // Pre-check de papel para a mensagem ser honesta na UI: sem ele o vendedor
  // veria "etapa invalida" (o 42501 do with check e' o mesmo SQLSTATE das duas
  // recusas — ver codigoDoErroAoGravarScript em lib/data/scripts.ts). A guarda
  // de verdade continua sendo a RLS da 0020; isto aqui e' so a traducao.
  if (contexto.valor.papel === 'vendedor') return falha('sem_permissao')

  const r = await contexto.valor.scripts.criar(dados.valor)
  if (!r.ok) return falha(r.erro)

  // Biblioteca vive em /disparo desde a Task 7 (Plano 13); /scripts so
  // redireciona para la. Revalidar a rota velha nao invalidaria nada que
  // ainda seja servido.
  revalidatePath('/disparo')
  return ok(r.valor)
}

export async function atualizarScript(id: string, d: DadosScript): Promise<Resultado<void>> {
  const dados = validar(d)
  if (!dados.ok) return falha(dados.erro)

  const contexto = await criarScriptStoreDoServidor()
  if (!contexto.ok) return falha(codigoDoErroDaAcao(contexto.erro))
  if (contexto.valor.papel === 'vendedor') return falha('sem_permissao')

  const r = await contexto.valor.scripts.atualizar(id, dados.valor)
  if (!r.ok) return falha(r.erro)

  revalidatePath('/disparo')
  revalidatePath(`/scripts/${id}`)
  return ok(undefined)
}

/** So resolve o store e pre-checa o papel: nao ha campo nenhum para validar. */
export async function excluirScript(id: string): Promise<Resultado<void>> {
  const contexto = await criarScriptStoreDoServidor()
  if (!contexto.ok) return falha(codigoDoErroDaAcao(contexto.erro))
  if (contexto.valor.papel === 'vendedor') return falha('sem_permissao')

  const r = await contexto.valor.scripts.excluir(id)
  if (!r.ok) return falha(r.erro)

  revalidatePath('/disparo')
  revalidatePath(`/scripts/${id}`)
  return ok(undefined)
}
