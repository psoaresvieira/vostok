import { redirect } from 'next/navigation'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import { criarNotificacaoStoreDoServidor } from '@/lib/data/notificacoes'
import type { Notificacao } from '@/lib/data/notificacoes'
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

  // Degrada para sino vazio em vez de derrubar a navegacao inteira: este
  // layout envolve TODA pagina do app, e uma falha aqui (banco fora do ar,
  // sessao inconsistente) nao pode impedir quem so queria ver o funil.
  // criarNotificacaoStoreDoServidor() so falha por sem_sessao, e a sessao ja
  // foi confirmada por criarStoreDoServidor() acima — na pratica so falharia
  // numa corrida de logout entre as duas chamadas.
  let contagemNaoLidas = 0
  let notificacoes: Notificacao[] = []
  const contextoNotif = await criarNotificacaoStoreDoServidor()
  if (contextoNotif.ok) {
    const [c, n] = await Promise.all([
      contextoNotif.valor.naoLidas(),
      contextoNotif.valor.listar(LIMITE_NOTIFICACOES),
    ])
    if (c.ok) contagemNaoLidas = c.valor
    if (n.ok) notificacoes = n.valor
  }

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
