import { redirect } from 'next/navigation'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import { criarNotificacaoStoreDoServidor } from '@/lib/data/notificacoes'
import type { Notificacao } from '@/lib/data/notificacoes'
import { BarraLateral } from './barra-lateral'

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
  // Tudo o que o layout le anda em paralelo, porque nada aqui depende de nada:
  // perfil e notificacoes so' precisam da sessao, e as duas leituras de
  // notificacao so' precisam do store.
  //
  // `perfilAtual()` e nao `membros()`: o rodape da barra mostra UM nome, o de
  // quem esta logado, e `membros()` lia a membership + o perfil de toda a
  // conta para achar essa linha — em CADA navegacao, porque este layout
  // envolve toda pagina do app. Degrada para null (o avatar cai para as
  // iniciais da conta) em vez de derrubar a pagina, como antes.
  const [perfil, notificacao] = await Promise.all([
    r.valor.store.perfilAtual(),
    (async () => {
      const contextoNotif = await criarNotificacaoStoreDoServidor()
      if (!contextoNotif.ok) return { contagem: 0, lista: [] as Notificacao[] }
      const [c, n] = await Promise.all([
        contextoNotif.valor.naoLidas(),
        contextoNotif.valor.listar(LIMITE_NOTIFICACOES),
      ])
      return { contagem: c.ok ? c.valor : 0, lista: n.ok ? n.valor : [] }
    })(),
  ])

  const nomeUsuario = perfil.ok ? (perfil.valor?.nome ?? null) : null
  const contagemNaoLidas = notificacao.contagem
  const notificacoes = notificacao.lista

  return (
    // items-start e' o que faz o `sticky top-0` da barra funcionar: num flex
    // container, o default `align-items: stretch` estica o <aside> ate a altura
    // da linha inteira, e um elemento ja tao alto quanto o pai nao tem para
    // onde grudar — o sticky vira no-op silencioso.
    <div className="flex min-h-screen items-start">
      <BarraLateral
        conta={r.valor.conta.nome}
        papel={r.valor.papel}
        nomeUsuario={nomeUsuario}
        contagemNaoLidas={contagemNaoLidas}
        notificacoes={notificacoes}
      />
      {/* min-w-0 e' obrigatorio: sem ele o <main> ganha `min-width: auto` de
          item flex e o quadro do funil, que rola na horizontal, EMPURRA a
          largura do main em vez de rolar dentro dele — a pagina inteira passa a
          ter scroll horizontal e a barra lateral sai da tela junto. */}
      <main className="flex min-h-screen min-w-0 flex-1 flex-col">{children}</main>
    </div>
  )
}
