'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Columns3, KeyRound, LogOut, PanelLeft, ChartColumn, ListChecks, Settings, Shield } from 'lucide-react'
import { IconeWhatsApp } from '@/components/ui/icone-whatsapp'
import type { Papel } from '@/lib/domain/tipos'
import type { Notificacao } from '@/lib/data/notificacoes'
import { cn } from '@/lib/ui/cn'
import { Sino } from './sino'
import { sair } from '../(auth)/acoes'

/** Chave do localStorage que guarda o estado recolhido da barra. */
const CHAVE_RECOLHIDA = 'vostok:barra-recolhida'

/**
 * O icone vem PRONTO como elemento, e nao como componente a instanciar: a
 * lista mistura icones do lucide (traçados, que aceitam `strokeWidth`) com o
 * glifo do WhatsApp (preenchido, que nao aceita), e um unico tipo de
 * componente nao cobriria os dois sem prop opcional que metade ignora. Assim
 * cada item declara o proprio ajuste fino no lugar onde ele e' obvio.
 */
type Item = { href: string; rotulo: string; icone: ReactNode }

/** Tamanho e traco compartilhados pelos icones lucide da barra. */
const PROPS_ICONE = { size: 19, strokeWidth: 1.75, 'aria-hidden': true, className: 'shrink-0' } as const

/**
 * Os quatro destinos da navegacao principal. A ordem e' a do fluxo de
 * trabalho — onde o lead entra (Funil), o que ele virou (Metricas), o que se
 * faz com ele (Disparo, Tarefas) — e nao alfabetica.
 *
 * /tarefas volta para a navegacao aqui. Ela tinha saido do header na Task 8 do
 * Plano 13 por falta de espaco horizontal (a rota nunca deixou de existir); a
 * barra lateral e' vertical e o espaco que motivou a remocao nao existe mais.
 */
const ITENS: Item[] = [
  { href: '/funil', rotulo: 'Funil', icone: <Columns3 {...PROPS_ICONE} /> },
  { href: '/metricas', rotulo: 'Métricas', icone: <ChartColumn {...PROPS_ICONE} /> },
  // O <h1> da propria tela continua "Disparo de WhatsApp"; encurtado so' aqui,
  // onde o logo ao lado ja diz de que canal se trata. Isso mudou o nome
  // acessivel do link de "Disparo de WPP" para "Disparo" — os dois seletores
  // `exact: true` de navegacao.spec.ts foram atualizados junto.
  { href: '/disparo', rotulo: 'Disparo', icone: <IconeWhatsApp size={19} className="shrink-0" /> },
  { href: '/tarefas', rotulo: 'Tarefas', icone: <ListChecks {...PROPS_ICONE} /> },
]

/** Iniciais para o avatar do rodape: "O Grupo SE7E" -> "OG". */
function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return '?'
  return (partes[0][0] + (partes[1]?.[0] ?? '')).toUpperCase()
}

const RÓTULO_PAPEL: Record<Papel, string> = {
  admin: 'Administrador',
  gestor: 'Gestor',
  vendedor: 'Vendedor',
}

export function BarraLateral({
  conta,
  papel,
  nomeUsuario,
  contagemNaoLidas,
  notificacoes,
  dono,
}: {
  conta: string
  papel: Papel
  nomeUsuario: string | null
  contagemNaoLidas: number
  notificacoes: Notificacao[]
  dono: boolean
}) {
  const caminho = usePathname()
  // Comeca SEMPRE expandida e so recolhe depois do efeito, mesmo que o
  // localStorage diga o contrario: ler storage no inicializador do useState
  // roda no servidor tambem (onde ele nao existe) e, quando existe, produz um
  // primeiro render diferente do HTML que o servidor mandou — o erro de
  // hidratacao classico. O preco e' um flash de barra larga em quem a deixou
  // recolhida; o preco do outro caminho e' o React descartar a arvore inteira.
  const [recolhida, setRecolhida] = useState(false)

  useEffect(() => {
    setRecolhida(window.localStorage.getItem(CHAVE_RECOLHIDA) === '1')
  }, [])

  function alternar() {
    setRecolhida((v) => {
      window.localStorage.setItem(CHAVE_RECOLHIDA, v ? '0' : '1')
      return !v
    })
  }

  // Item extra so' para o dono da plataforma — nao mistura em ITENS porque
  // ITENS e' modulo-level e compartilhado por toda navegacao, dono ou nao.
  const itens = dono
    ? [...ITENS, { href: '/admin', rotulo: 'Admin', icone: <Shield {...PROPS_ICONE} /> }]
    : ITENS

  return (
    <aside
      // A barra e' `sticky` e nao `fixed` para o <main> ao lado nao precisar de
      // margem compensatoria: no fixed, qualquer mudanca de largura aqui teria
      // que ser espelhada a mao no conteudo, e as duas inevitavelmente
      // divergiriam.
      className={cn(
        'sticky top-0 z-30 flex h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar',
        'transition-[width] duration-300 ease-out',
        recolhida ? 'w-[4.5rem]' : 'w-60',
      )}
    >
      <div className="flex h-14 items-center gap-2 px-3">
        <Link
          href="/funil"
          className="pressable flex min-w-0 items-center gap-2 rounded-lg px-1 py-1"
          aria-label="Vostok"
        >
          {/* Marca em quadrado, no lugar de um <img>: nao ha arquivo de logo no
              repo, e um SVG de 24px aqui evita inventar um asset que ninguem
              aprovou. */}
          <span
            aria-hidden="true"
            className="grid size-8 shrink-0 place-items-center rounded-[0.6rem] bg-primary text-[13px] font-bold text-primary-foreground"
          >
            V
          </span>
          {!recolhida && (
            <span className="truncate font-display text-[15px] font-semibold tracking-tight text-sidebar-foreground">
              Vostok
            </span>
          )}
        </Link>
        {!recolhida && (
          <button
            type="button"
            onClick={alternar}
            aria-label="Recolher menu"
            className="pressable ml-auto rounded-lg p-1.5 text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <PanelLeft size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
      </div>

      {recolhida && (
        <button
          type="button"
          onClick={alternar}
          aria-label="Expandir menu"
          className="pressable mx-auto mb-1 rounded-lg p-1.5 text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <PanelLeft size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}

      {/* Conta ativa. Recolhida, some — o avatar do rodape ja carrega a
          identidade e repetir aqui gastaria a altura util da barra. */}
      {!recolhida && (
        <div className="mx-3 mb-2 truncate rounded-xl bg-sidebar-accent/60 px-3 py-2">
          <p className="truncate text-[13px] font-medium text-sidebar-foreground">{conta}</p>
        </div>
      )}

      <nav aria-label="Navegação principal" className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-1">
        {itens.map(({ href, rotulo, icone }) => {
          // startsWith e nao ===: uma sub-rota (/scripts/[id], por exemplo)
          // deve manter o item pai aceso. A raiz '/' nunca aparece em ITENS,
          // entao nao ha o falso positivo de startsWith('/').
          const ativo = caminho === href || caminho.startsWith(`${href}/`)
          return (
            <Link
              key={href}
              href={href}
              aria-current={ativo ? 'page' : undefined}
              title={recolhida ? rotulo : undefined}
              className={cn(
                'pressable flex h-10 items-center gap-3 rounded-xl px-2.5 text-sm font-medium',
                recolhida && 'justify-center px-0',
                ativo
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-muted hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
              )}
            >
              {/* 1.75 no PROPS_ICONE, e nao o 2 padrao do lucide: o traco do
                  SF Symbols e' mais fino que o do Feather, e num icone de 19px
                  a diferenca e' o que separa "app da Apple" de "dashboard
                  generico". */}
              {icone}
              {!recolhida && <span className="truncate">{rotulo}</span>}
            </Link>
          )
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-1 border-t border-sidebar-border px-3 py-3">
        <div className={cn('flex items-center gap-1', recolhida && 'flex-col')}>
          {/* O sino traz o proprio painel e o proprio badge; aqui ele so ganha
              o lugar. Envolvido para o layout do rodape nao depender da
              estrutura interna dele. */}
          <Sino contagem={contagemNaoLidas} notificacoes={notificacoes} />
          {papel === 'admin' && (
            <Link
              href="/config"
              aria-label="Configuração"
              title="Configuração"
              className={cn(
                'pressable rounded-xl p-2.5 text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground',
                caminho.startsWith('/config') && 'bg-sidebar-accent text-sidebar-foreground',
              )}
            >
              <Settings size={19} strokeWidth={1.75} aria-hidden="true" />
            </Link>
          )}
          {/* Trocar senha (Task 3): para TODOS os papeis, diferente do
              /config acima — a senha e' do usuario, nao um privilegio de
              admin. */}
          <Link
            href="/senha"
            aria-label="Trocar senha"
            title="Trocar senha"
            className={cn(
              'pressable rounded-xl p-2.5 text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground',
              caminho.startsWith('/senha') && 'bg-sidebar-accent text-sidebar-foreground',
            )}
          >
            <KeyRound {...PROPS_ICONE} />
          </Link>
          <form action={sair} className={cn(!recolhida && 'ml-auto')}>
            <button
              type="submit"
              aria-label="Sair"
              title="Sair"
              className="pressable rounded-xl p-2.5 text-sidebar-muted hover:bg-destructive/12 hover:text-destructive"
            >
              <LogOut size={19} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </form>
        </div>

        <div
          className={cn(
            'mt-1 flex items-center gap-2.5 rounded-xl px-1 py-1.5',
            recolhida && 'justify-center px-0',
          )}
        >
          <span
            aria-hidden="true"
            className="grid size-8 shrink-0 place-items-center rounded-full bg-sidebar-accent text-[11px] font-semibold text-sidebar-foreground"
          >
            {iniciais(nomeUsuario ?? conta)}
          </span>
          {!recolhida && (
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-sidebar-foreground">
                {nomeUsuario ?? conta}
              </p>
              <p className="truncate text-[11px] text-sidebar-muted">{RÓTULO_PAPEL[papel]}</p>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}

/** Exportado so para o teste do rotulo do avatar. */
export const _iniciais = iniciais
