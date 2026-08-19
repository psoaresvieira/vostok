import { redirect } from 'next/navigation'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import { criarTarefaStoreDoServidor } from '@/lib/data/tarefas'
import { ok } from '@/lib/domain/resultado'
import type { Membro, Papel } from '@/lib/domain/tipos'
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

  // store.membros() so alimenta o <select> de responsavel abaixo, que so
  // aparece para gestor/admin (papel !== 'vendedor', linha ~60). Antes esta
  // consulta rodava sempre, incondicional, e um erro dela virava
  // `throw new Error(membros.erro)` (convencao ja existente do repo — ver
  // funil/page.tsx, leads/[id]/page.tsx, config/page.tsx) que derrubava a
  // pagina inteira de /tarefas para o vendedor, por causa de um dado que ele
  // nunca ve. Para vendedor nem chamamos store.membros(): o resultado fica
  // fixo em `ok([])`, que nunca falha, entao o `throw` abaixo nunca dispara
  // por causa desse ramo. Achado Important 4 do review da Task 6.
  //
  // Independente de membros() (so precisa de `store`), entao roda em
  // paralelo com criarTarefaStoreDoServidor() — os dois `await` em serie que
  // o mesmo review pediu para juntar.
  const [membros, tarefaStore] = await Promise.all([
    papel === 'vendedor' ? Promise.resolve(ok<Membro[]>([])) : store.membros(),
    criarTarefaStoreDoServidor(),
  ])
  if (!membros.ok) throw new Error(membros.erro)
  if (!tarefaStore.ok) throw new Error(tarefaStore.erro)

  const responsavelId = resolverResponsavelId(papel, usuarioId, params.responsavel)
  const tarefas = await tarefaStore.valor.minhasAbertas(responsavelId)
  if (!tarefas.ok) {
    return (
      <div className="fade-in flex flex-col gap-6 p-6 sm:p-8">
        <h1 className="text-[26px] font-semibold">Tarefas</h1>
        <p className="text-destructive">{mensagemDeErroTarefa(tarefas.erro)}</p>
      </div>
    )
  }

  return (
    <div className="fade-in flex flex-col gap-6 p-6 sm:p-8">
      <h1 className="text-[26px] font-semibold">Tarefas</h1>

      {papel !== 'vendedor' && (
        <form className="flex items-center gap-2" action="/tarefas">
          <select
            name="responsavel"
            defaultValue={params.responsavel ?? ''}
            className="rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-sm"
          >
            <option value="">Minhas tarefas</option>
            {membros.valor.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome}
              </option>
            ))}
            <option value="sem">Sem responsável</option>
          </select>
          <button type="submit" className="rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-sm">
            Filtrar
          </button>
        </form>
      )}

      <Lista tarefas={tarefas.valor} agora={new Date()} />
    </div>
  )
}
