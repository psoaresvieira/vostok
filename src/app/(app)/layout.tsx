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
  //
  // Ate a Task 8 do Plano 13 (remodelada) este bloco rodava em Promise.all
  // junto com a consulta de tarefas urgentes que alimentava o badge do link
  // "Tarefas" do header — a Task 8 removeu o link e o badge (a rota /tarefas
  // continua de pe, so nao esta mais listada aqui), entao essa segunda
  // consulta e o paralelismo que ela justificava saíram com ela.
  const contextoNotif = await criarNotificacaoStoreDoServidor()

  let contagemNaoLidas = 0
  let notificacoes: Notificacao[] = []

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
          <span className="font-display text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Vostok
          </span>
          <span className="font-semibold">{r.valor.conta.nome}</span>
          {/* Tres abas, na forma nova da Task 8 (Plano 13 remodelada):
              Funil, Metricas, Disparo de WPP. Tarefas saiu (link e badge —
              /tarefas continua de pe, so nao esta mais listada aqui) e
              Scripts virou Disparo de WPP, que aponta para /disparo.

              <a> continua deliberado, nao <Link>: /disparo nao tem rota
              dinamica irma hoje ('/disparo/[algo]' nao existe), entao nenhum
              dos dois motivos que forcava <a> em "/scripts" (a regra do
              @next/next contra o par com [id]) se aplica aqui. E' so a mesma
              convencao dos vizinhos Funil/Metricas — se um dia /disparo/[id]
              nascer, este comentario e o motivo para reavaliar, do mesmo jeito
              que "/scripts" precisou do disable. */}
          <nav aria-label="Navegação principal" className="flex items-center gap-4">
            <a href="/funil" className="text-sm underline">
              Funil
            </a>
            <a href="/metricas" className="text-sm underline">
              Métricas
            </a>
            <a href="/disparo" className="text-sm underline">
              Disparo de WPP
            </a>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          {r.valor.papel === 'admin' && (
            // Icone, nao texto: a Task 8 encolheu "Configuração" para uma
            // engrenagem discreta ao lado do sino, admin only. aria-label
            // proprio porque o SVG nao carrega texto nenhum — sem ele o nome
            // acessivel do link ficaria vazio. svg com aria-hidden: o rotulo
            // ja esta no <a>, duplicar no filho so criaria dois anuncios.
            <a
              href="/config"
              aria-label="Configuração"
              className="rounded p-1 text-muted-foreground hover:text-foreground"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                width="18"
                height="18"
                aria-hidden="true"
                focusable="false"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
              </svg>
            </a>
          )}
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
