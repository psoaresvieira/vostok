import { redirect } from 'next/navigation'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import { criarTarefaStoreDoServidor } from '@/lib/data/tarefas'
import type { Papel } from '@/lib/domain/tipos'
import { Lista } from './lista'
import { mensagemDeErroTarefa } from './erros'

// Parametro `responsavel` na URL, com tres estados possiveis que NAO podem
// colidir na mesma representacao (ver ambiguidade 3 do brief da Task 6):
//   - ausente (ou '')   -> as tarefas do proprio usuario logado (padrao)
//   - 'sem'             -> filtro "Sem responsavel", que vira null no port
//   - qualquer outro id -> as tarefas daquele membro
// Vendedor ignora o parametro por completo e sempre ve as suas: nao basta
// ser o padrao, tem que ser incondicional, senao um vendedor manipulando a
// URL veria tarefa de outra pessoa.
function resolverResponsavelId(
  papel: Papel,
  usuarioId: string,
  paramResponsavel: string | undefined,
): string | null {
  if (papel === 'vendedor') return usuarioId
  if (paramResponsavel === undefined || paramResponsavel === '') return usuarioId
  if (paramResponsavel === 'sem') return null
  return paramResponsavel
}

export default async function TarefasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const params = await searchParams
  const contexto = await criarStoreDoServidor()
  if (!contexto.ok) redirect('/login')
  const { store, papel, usuarioId } = contexto.valor

  const membros = await store.membros()
  if (!membros.ok) throw new Error(membros.erro)

  const tarefaStore = await criarTarefaStoreDoServidor()
  if (!tarefaStore.ok) throw new Error(tarefaStore.erro)

  const responsavelId = resolverResponsavelId(papel, usuarioId, params.responsavel)
  const tarefas = await tarefaStore.valor.minhasAbertas(responsavelId)
  if (!tarefas.ok) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <h1 className="text-2xl font-semibold">Tarefas</h1>
        <p className="text-destructive">{mensagemDeErroTarefa(tarefas.erro)}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">Tarefas</h1>

      {papel !== 'vendedor' && (
        <form className="flex items-center gap-2" action="/tarefas">
          <select
            name="responsavel"
            defaultValue={params.responsavel ?? ''}
            className="rounded border border-border px-2 py-1 text-sm"
          >
            <option value="">Minhas tarefas</option>
            {membros.valor.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome}
              </option>
            ))}
            <option value="sem">Sem responsável</option>
          </select>
          <button type="submit" className="rounded border border-border px-2 py-1 text-sm">
            Filtrar
          </button>
        </form>
      )}

      <Lista tarefas={tarefas.valor} agora={new Date()} />
    </div>
  )
}
