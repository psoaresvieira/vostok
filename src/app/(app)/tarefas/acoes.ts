'use server'

import { revalidatePath } from 'next/cache'
import {
  criarTarefaStoreDoServidor,
  TAREFA_CONCLUIDA_SEM_EVENTO,
  type TipoTarefa,
} from '@/lib/data/tarefas'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'

// Task 6 chama concluirTarefa (e as demais) de /tarefas tambem — um lugar so
// para as Server Actions, revalidando os dois caminhos que dependem do
// estado de uma tarefa.
//
// `/funil` e nao `/leads/<id>`: o painel de tarefas do lead virou a aba
// Tarefas do drawer do funil (spec 2026-08-28), e a rota antiga so' redireciona
// — revalida-la nao repinta tela nenhuma.
function revalidarTelasDeTarefa() {
  revalidatePath('/funil')
  revalidatePath('/tarefas')
}

export async function criarTarefa(d: {
  leadId: string
  titulo: string
  tipo: TipoTarefa
  venceEmISO: string
}): Promise<Resultado<void>> {
  const titulo = d.titulo.trim()
  if (titulo.length === 0) return falha('titulo_vazio')

  // Validar antes de construir o Date que vai para o banco: entrada de
  // usuario vira data invalida com facilidade (o Plano 6 deixou um
  // ?dias=999999999 estourar RangeError para fora de um server component), e
  // o lugar de barrar e a borda, nao o port.
  const venceEm = new Date(d.venceEmISO)
  if (Number.isNaN(venceEm.getTime())) return falha('prazo_invalido')

  const contexto = await criarTarefaStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)

  const r = await contexto.valor.criar({ leadId: d.leadId, titulo, tipo: d.tipo, venceEm })
  if (!r.ok) return falha(r.erro)

  revalidarTelasDeTarefa()
  return ok(undefined)
}

// `leadId` fica na assinatura das tres actions abaixo so' para simetria com
// os chamadores (tarefas.tsx e lista.tsx passam sempre `(id, leadId)`) — a
// unica leitura que fazia dele virou `revalidarTelasDeTarefa()` sem
// parametro nenhum.
export async function concluirTarefa(id: string, _leadId: string): Promise<Resultado<void>> {
  const contexto = await criarTarefaStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)

  // O evento de timeline (tarefa_concluida) e escrito dentro do proprio
  // TarefaStore.concluir — ver comentario em lib/data/tarefas.ts. Se a
  // conclusao falhar, este r.ok e false e nenhum evento foi inserido.
  const r = await contexto.valor.concluir(id)
  if (!r.ok) {
    // Excecao unica: neste codigo a tarefa FOI concluida no banco e so o
    // evento da timeline falhou. O estado mudou, entao a tela tem que ser
    // revalidada assim mesmo — sem isto o painel seguiria mostrando a tarefa
    // aberta com o botao "Concluir", e o proximo clique re-carimbaria
    // concluida_em/concluida_por e gravaria um segundo evento.
    if (r.erro === TAREFA_CONCLUIDA_SEM_EVENTO) revalidarTelasDeTarefa()
    return falha(r.erro)
  }

  revalidarTelasDeTarefa()
  return ok(undefined)
}

export async function reabrirTarefa(id: string, _leadId: string): Promise<Resultado<void>> {
  const contexto = await criarTarefaStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)

  // Reabrir nao escreve evento nenhum, de proposito: so concluir marca a
  // timeline. Concluir -> reabrir -> concluir deixa dois eventos, e essa e
  // uma consequencia aceita (lead_events e append-only por desenho).
  const r = await contexto.valor.reabrir(id)
  if (!r.ok) return falha(r.erro)

  revalidarTelasDeTarefa()
  return ok(undefined)
}

export async function excluirTarefa(id: string, _leadId: string): Promise<Resultado<void>> {
  const contexto = await criarTarefaStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)

  const r = await contexto.valor.excluir(id)
  if (!r.ok) return falha(r.erro)

  revalidarTelasDeTarefa()
  return ok(undefined)
}
