'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { Script } from '@/lib/data/scripts'
import {
  contarPendencias,
  interpolar,
  linkWhatsApp,
  textoPlano,
  type ContextoScript,
} from '@/lib/domain/script'
import { mensagemDeErroScript } from '@/app/(app)/scripts/erros'

/** Quanto tempo o "Copiado ✓" fica visivel antes de sumir sozinho — mesma
 * duracao e mesmo motivo do "Salvo ✓" de config/etapas.tsx: um sinal
 * transitorio que fica colado na tela passa a acompanhar eventos que nao sao
 * dele. */
const DURACAO_COPIADO_MS = 2_500

function plural(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`
}

function ItemScript({
  script,
  contexto,
  telefoneE164,
}: {
  script: Script
  contexto: ContextoScript
  telefoneE164: string | null
}) {
  const [copiado, setCopiado] = useState(false)
  const [erroCopia, setErroCopia] = useState<string | null>(null)
  const timeoutCopiado = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timeoutCopiado.current) clearTimeout(timeoutCopiado.current)
    }
  }, [])

  // UMA interpolacao por script, e os TRES consumidores saem dela: a previa
  // pintada abaixo, o Copiar e o link do wa.me. Nao existe segundo caminho de
  // render que possa divergir — e' a mesma disciplina do preview do editor.
  const segmentos = interpolar(script.conteudo, contexto)
  const texto = textoPlano(segmentos)
  const pendencias = contarPendencias(segmentos)

  async function copiar() {
    // ATENCAO: o texto vem de textoPlano(segmentos), NUNCA do DOM da previa.
    // A previa renderiza cada lacuna como <mark> com um <span class="sr-only">
    // dentro (o rotulo que leitor de tela le), entao o textContent dela e'
    // "... {{empresa}} empresa sem valor ..." — ler o DOM mandaria esse rotulo
    // escondido para o WhatsApp do lead. A previa NAO e' fonte de texto plano.
    if (!navigator.clipboard?.writeText) {
      // Contexto inseguro (http num IP da rede local, por exemplo): a Clipboard
      // API simplesmente nao existe. Dizer isso e' melhor do que um clique mudo
      // que o vendedor le como "copiou".
      setErroCopia('Não foi possível copiar aqui. Selecione o texto da prévia.')
      return
    }
    try {
      await navigator.clipboard.writeText(texto)
    } catch {
      setErroCopia('Não foi possível copiar. Tente de novo.')
      return
    }
    setErroCopia(null)
    if (timeoutCopiado.current) clearTimeout(timeoutCopiado.current)
    setCopiado(true)
    timeoutCopiado.current = setTimeout(() => {
      setCopiado(false)
      timeoutCopiado.current = null
    }, DURACAO_COPIADO_MS)
  }

  return (
    <li className="flex flex-col gap-2 rounded border border-border p-2">
      <h3 className="text-sm font-medium">{script.titulo}</h3>

      <div
        role="region"
        aria-label={`Prévia de ${script.titulo}`}
        className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-sm"
      >
        {segmentos.map((seg, i) => {
          if (seg.tipo === 'lacuna') {
            return (
              // Mesma marca do editor, pelo mesmo motivo: a tag literal
              // continua no texto (lacuna invisivel = mensagem com buraco
              // enviada de verdade), e o rotulo vai num <span> escondido DENTRO
              // da marca — <mark> tem papel ARIA name-prohibited, entao um
              // aria-label nela nao chega a leitor de tela nenhum.
              <mark key={i} className="rounded bg-warning/25 px-0.5 text-warning">
                {seg.texto}
                <span className="sr-only">{` ${seg.nome} sem valor`}</span>
              </mark>
            )
          }
          if (seg.tipo === 'desconhecida') {
            return (
              <mark
                key={i}
                className="rounded bg-destructive/25 px-0.5 text-destructive underline decoration-dotted"
              >
                {seg.texto}
                <span className="sr-only">{` ${seg.nome} não é uma variável`}</span>
              </mark>
            )
          }
          return <span key={i}>{seg.texto}</span>
        })}
      </div>

      {/* O contador e' o AVISO, nao um bloqueio: copiar e enviar continuam
          liberados com pendencia (spec §4.4) — quem decide mandar assim mesmo
          e' o vendedor, que esta olhando o lead. */}
      {pendencias.lacunas > 0 && (
        <p className="text-xs text-warning">
          {plural(pendencias.lacunas, 'variável sem valor', 'variáveis sem valor')}
        </p>
      )}
      {pendencias.desconhecidas > 0 && (
        <p className="text-xs text-destructive">
          {plural(
            pendencias.desconhecidas,
            'variável desconhecida',
            'variáveis desconhecidas',
          )}{' '}
          — confira o nome no script.
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void copiar()}
          className="rounded border border-border px-2 py-1 text-xs"
        >
          Copiar
        </button>

        {telefoneE164 ? (
          <a
            href={linkWhatsApp(telefoneE164, texto)}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-border px-2 py-1 text-xs"
          >
            WhatsApp
          </a>
        ) : (
          // Botao desabilitado com title, e nunca um <a> para wa.me sem numero:
          // o link morto abriria o WhatsApp num numero vazio e o vendedor so
          // descobriria depois de trocar de aba.
          <button
            type="button"
            disabled
            title="Este lead não tem telefone"
            className="rounded border border-border px-2 py-1 text-xs opacity-50"
          >
            WhatsApp
          </button>
        )}

        {/* Fora do botao de proposito: o nome acessivel do "Copiar" nao pode
            mudar depois do primeiro uso, senao quem navega por teclado perde o
            alvo. role="status" da o aria-live polite que anuncia a mudanca. */}
        {copiado && (
          <span role="status" className="text-xs text-success">
            Copiado ✓
          </span>
        )}
      </div>

      {erroCopia && <p className="text-xs text-destructive">{erroCopia}</p>}
    </li>
  )
}

/**
 * Painel de scripts da ficha do lead: os scripts da etapa em que o lead esta
 * (mais os "qualquer etapa"), ja interpolados com ESTE lead.
 *
 * `erro` e' o codigo de uma falha de leitura no servidor. O painel e' acessorio
 * da ficha — a mesma regra do sino/badge do layout —, entao page.tsx degrada
 * para ca em vez de derrubar a ficha inteira por uma consulta de scripts que
 * falhou.
 */
export function PainelScripts({
  scripts,
  contexto,
  telefoneE164,
  erro = null,
}: {
  scripts: Script[]
  contexto: ContextoScript
  telefoneE164: string | null
  erro?: string | null
}) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">Scripts</h2>

      {erro ? (
        // Nunca o estado vazio aqui: "Nenhum script para esta etapa" seria uma
        // AFIRMACAO sobre a biblioteca que ninguem pode fazer — a consulta nem
        // respondeu.
        <p className="text-sm text-destructive">{mensagemDeErroScript(erro)}</p>
      ) : scripts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum script para esta etapa.{' '}
          <Link href="/scripts" className="underline">
            Ver a biblioteca de scripts
          </Link>
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {scripts.map((s) => (
            <ItemScript
              key={s.id}
              script={s}
              contexto={contexto}
              telefoneE164={telefoneE164}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
