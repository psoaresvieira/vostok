import { redirect } from 'next/navigation'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import { criarNotificacaoStoreDoServidor } from '@/lib/data/notificacoes'
import type { Notificacao } from '@/lib/data/notificacoes'
import { criarTarefaStoreDoServidor } from '@/lib/data/tarefas'
import { contarUrgentes, FUSO_PADRAO } from '@/lib/domain/tarefa'
import { Sino } from './sino'
import { sair } from '../(auth)/acoes'

/** Quantas notificacoes recentes o painel do sino mostra. */
const LIMITE_NOTIFICACOES = 20

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const r = await criarStoreDoServidor()
  if (!r.ok) {
    if (r.erro === 'sem_sessao') redirect('/login')
    if (r.erro === 'sem_conta') redirect('/signup')
    throw new Error(r.erro)
  }

  // Os dois blocos abaixo (sino e badge de tarefas) so precisam de r.valor,
  // ja resolvido acima, e nao dependem um do outro. Antes rodavam em serie —
  // criarTarefaStoreDoServidor() (criarClienteServidor() + auth.getUser())
  // so disparava DEPOIS do round-trip inteiro do sino — somando duas idas ao
  // servidor extras, em serie, a latencia de toda pagina do app, inclusive
  // para quem nunca clica em Tarefas. Promise.all os poe em paralelo sem
  // abrir mao da tolerancia a falha de nenhum dos dois: cada bloco degrada
  // para o proprio "vazio" checando `.ok`, nunca lanca, e a falha de um
  // nunca impede o outro nem a pagina. Achado Important 2 do review da
  // Task 6.
  const [contextoNotif, contextoTarefas] = await Promise.all([
    criarNotificacaoStoreDoServidor(),
    criarTarefaStoreDoServidor(),
  ])

  // Degrada para sino vazio em vez de derrubar a navegacao inteira: este
  // layout envolve TODA pagina do app, e uma falha aqui (banco fora do ar,
  // sessao inconsistente) nao pode impedir quem so queria ver o funil.
  // criarNotificacaoStoreDoServidor() so falha por sem_sessao, e a sessao ja
  // foi confirmada por criarStoreDoServidor() acima — na pratica so falharia
  // numa corrida de logout entre as duas chamadas.
  let contagemNaoLidas = 0
  let notificacoes: Notificacao[] = []

  // Mesmo padrao tolerante a falha do bloco do sino acima: falha aqui vira
  // badge zero, nunca derruba a navegacao inteira. Conta SEMPRE as tarefas do
  // proprio usuario logado (r.valor.usuarioId), nos tres papeis, independente
  // do filtro que a tela /tarefas esteja exibindo no momento — este layout
  // envolve toda pagina do app e nao conhece a URL da tela; um badge que
  // mudasse com o filtro de outra pessoa seria mentira. contarUrgentes recebe
  // Date[], nao Tarefa[]: e dominio puro e nao conhece o tipo do port.
  let tarefasUrgentes = 0

  await Promise.all([
    (async () => {
      if (!contextoNotif.ok) return
      const [c, n] = await Promise.all([
        contextoNotif.valor.naoLidas(),
        contextoNotif.valor.listar(LIMITE_NOTIFICACOES),
      ])
      if (c.ok) contagemNaoLidas = c.valor
      if (n.ok) notificacoes = n.valor
    })(),
    (async () => {
      if (!contextoTarefas.ok) return
      const t = await contextoTarefas.valor.minhasAbertas(r.valor.usuarioId)
      if (t.ok) {
        tarefasUrgentes = contarUrgentes(
          t.valor.map((tarefa) => tarefa.venceEm),
          new Date(),
          FUSO_PADRAO,
        )
      }
    })(),
  ])

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-4">
          <span className="font-semibold">{r.valor.conta.nome}</span>
          <a href="/funil" className="text-sm underline">
            Funil
          </a>
          <a href="/metricas" className="text-sm underline">
            Métricas
          </a>
          <a href="/tarefas" className="text-sm underline">
            Tarefas
            {tarefasUrgentes > 0 && (
              // aria-label proprio: sem ele o nome acessivel do link vira so
              // "Tarefas 2" (o digito cru concatenado ao texto), que nao diz
              // o que o numero significa. Com o aria-label, o nome acessivel
              // do <a> passa a ser "Tarefas 2 tarefas urgentes" — continua
              // comecando por "Tarefas", entao um getByRole por esse
              // substring (o E2E da Task 7 vai usar algo assim) continua
              // casando. Achado minor do review da Task 6.
              <span
                className="ml-1 rounded-full bg-destructive px-1.5 text-xs leading-4 text-destructive-foreground"
                aria-label={
                  tarefasUrgentes === 1 ? '1 tarefa urgente' : `${tarefasUrgentes} tarefas urgentes`
                }
              >
                {tarefasUrgentes}
              </span>
            )}
          </a>
          {r.valor.papel === 'admin' && (
            <a href="/config" className="text-sm underline">
              Configuração
            </a>
          )}
        </div>
        <div className="flex items-center gap-4">
          <Sino contagem={contagemNaoLidas} notificacoes={notificacoes} />
          <form action={sair}>
            <button type="submit" className="text-sm underline">
              Sair
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  )
}
