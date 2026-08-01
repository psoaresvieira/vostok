'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { criarClienteNavegador } from '@/lib/supabase/navegador'
import { chamarAcao } from '@/lib/ui/acao'
import type { Notificacao } from '@/lib/data/notificacoes'
import { marcarNotificacaoLidaAction, marcarTodasNotificacoesLidasAction } from './acoes-notificacoes'

type Props = {
  contagem: number
  notificacoes: Notificacao[]
}

const RÓTULO_TIPO: Record<Notificacao['tipo'], string> = {
  novo_lead: 'Novo lead',
  lead_reincidente: 'Lead reincidente',
}

/**
 * `contagem` e `notificacoes` vem do servidor (layout.tsx, que resolve o
 * NotificacaoStore com a sessao do usuario) e sao usadas DIRETO no render,
 * nunca copiadas para useState. E a mesma licao do useState(props) do Plano
 * 2: se essas props virassem estado inicial, o sino ficaria congelado no
 * valor de quando montou, e o router.refresh() disparado pelo Realtime
 * abaixo nao teria efeito nenhum na tela — as props novas chegariam, mas
 * o componente continuaria lendo o useState antigo.
 */
export function Sino({ contagem, notificacoes }: Props) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)

  useEffect(() => {
    const cliente = criarClienteNavegador()
    let cancelado = false
    let canal: RealtimeChannel | null = null

    async function assinar() {
      // O client de @supabase/ssr guarda a sessao no cookie (para o SSR poder
      // ler), mas o cliente Realtime interno e' um websocket separado que nao
      // le cookie nenhum — sem passar o token explicitamente ele conecta como
      // `anon`. notifications_dono_select (migration 0009) exige
      // usuario_id = auth.uid(), e para 'anon' isso nunca bate: a policy nega
      // tudo em silencio, sem erro em lugar nenhum, e o sintoma e exatamente
      // "nada chega". NAO REMOVA esta linha por parecer redundante com a
      // sessao do navegador — sao dois canais de autenticacao diferentes,
      // um para o REST/SSR (cookie) e outro para o Realtime (token no
      // websocket), e so o segundo alimenta auth.uid() dentro da policy.
      const { data } = await cliente.auth.getSession()
      if (cancelado) return
      if (data.session) cliente.realtime.setAuth(data.session.access_token)

      // Sem `filter`: a RLS e' o filtro. notifications_dono_select ja restringe
      // cada assinante as proprias linhas (o Realtime avalia a policy por
      // assinante), entao filtrar aqui de novo seria redundante no melhor caso
      // e mentiria sobre onde mora a garantia no pior — ver 0009_ingestao_log.sql.
      canal = cliente
        .channel('notificacoes')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'notifications' },
          () => {
            // Nunca insere o card/entrada no cliente: o mesmo bug do
            // useState(props) do quadro (Plano 2) — so router.refresh() busca
            // o layout de novo, com a contagem e a lista atualizadas do servidor.
            router.refresh()
          },
        )
        .subscribe()
    }

    void assinar()

    // Limpeza obrigatoria: sem removeChannel, cada navegacao soft (o
    // AppLayout nao desmonta entre paginas do (app)) deixaria um canal aberto
    // a mais, e o router.refresh() acima passaria a disparar N vezes por
    // notificacao — N canais acumulados, N refreshes por INSERT.
    return () => {
      cancelado = true
      if (canal) void cliente.removeChannel(canal)
    }
  }, [router])

  async function marcarTodasComoLidas() {
    const r = await chamarAcao(marcarTodasNotificacoesLidasAction())
    if (r.ok) router.refresh()
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Notificações"
        onClick={() => setAberto((v) => !v)}
        className="relative rounded p-1 text-sm"
      >
        🔔
        {contagem > 0 && (
          <span
            role="status"
            aria-label="notificações não lidas"
            className="absolute -right-1 -top-1 rounded-full bg-destructive px-1.5 text-xs leading-4 text-primary-foreground"
          >
            {contagem}
          </span>
        )}
      </button>

      {aberto && (
        <div
          role="region"
          aria-label="Notificações"
          className="absolute right-0 z-10 mt-2 w-80 rounded border bg-card shadow-lg"
        >
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-medium">Notificações</span>
            {contagem > 0 && (
              <button type="button" className="text-xs underline" onClick={marcarTodasComoLidas}>
                marcar todas como lidas
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {notificacoes.length === 0 && (
              <li className="px-3 py-4 text-sm text-muted-foreground">Nenhuma notificação ainda.</li>
            )}
            {notificacoes.map((n) => (
              <li key={n.id} className="border-b last:border-b-0">
                <Link
                  href={`/leads/${n.leadId}`}
                  onClick={() => {
                    setAberto(false)
                    // Melhor esforco: nao bloqueia a navegacao esperando a
                    // resposta, e um erro aqui nao impede o usuario de ver o
                    // lead que motivou a notificacao.
                    if (!n.lidaEm) void marcarNotificacaoLidaAction(n.id).catch(() => {})
                  }}
                  className={`block px-3 py-2 text-sm hover:bg-muted ${n.lidaEm ? 'text-muted-foreground' : 'font-medium'}`}
                >
                  {RÓTULO_TIPO[n.tipo]}: {n.leadNome}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
