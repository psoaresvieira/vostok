'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { Script } from '@/lib/data/scripts'
// Type-only: `import type` some na compilacao, entao lib/data/templates (e o
// next/headers que ele arrasta por baixo) nunca entra no bundle do browser.
import type { TemplateWhatsApp } from '@/lib/data/templates'
import type { Resultado } from '@/lib/domain/resultado'
import {
  contarPendencias,
  interpolar,
  linkWhatsApp,
  textoPlano,
  type ContextoScript,
} from '@/lib/domain/script'
import { chamarAcao } from '@/lib/ui/acao'
import { estaDesatualizado } from '@/app/(app)/scripts/desatualizado'
import { mensagemDeErroScript } from '@/app/(app)/scripts/erros'
import { PreviaSegmentos } from '@/app/(app)/scripts/previa'
import { enviarWhatsApp } from './acoes-whatsapp'

/** Quanto tempo o "Copiado ✓" / "Enviado ✓" fica visivel antes de sumir
 * sozinho — mesma duracao e mesmo motivo do "Salvo ✓" de config/etapas.tsx: um
 * sinal transitorio que fica colado na tela passa a acompanhar eventos que nao
 * sao dele. */
const DURACAO_FEEDBACK_MS = 2_500

type AcaoEnviar = (leadId: string, scriptId: string) => Promise<Resultado<void>>

function plural(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`
}

function ItemScript({
  script,
  contexto,
  telefoneE164,
  leadId,
  template,
  enviar,
}: {
  script: Script
  contexto: ContextoScript
  telefoneE164: string | null
  leadId: string
  template: TemplateWhatsApp | null
  enviar: AcaoEnviar
}) {
  const [copiado, setCopiado] = useState(false)
  const [erroCopia, setErroCopia] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [enviado, setEnviado] = useState(false)
  const [erroEnvio, setErroEnvio] = useState<string | null>(null)
  const timeoutCopiado = useRef<ReturnType<typeof setTimeout> | null>(null)
  const timeoutEnviado = useRef<ReturnType<typeof setTimeout> | null>(null)
  /**
   * Trava do envio em curso. Ref, e NAO o `enviando` do estado: dois cliques no
   * mesmo frame leem o mesmo valor de closure (`false` nos dois) e o
   * `disabled={enviando}` do DOM so vale depois do re-render — ou seja, o guard
   * por estado deixa passar os dois, e aqui isso custa DUAS mensagens enviadas
   * e cobradas pelo Meta. A ref muda no mesmo tick do primeiro clique.
   */
  const envioEmCurso = useRef(false)

  useEffect(() => {
    return () => {
      if (timeoutCopiado.current) clearTimeout(timeoutCopiado.current)
      if (timeoutEnviado.current) clearTimeout(timeoutEnviado.current)
    }
  }, [])

  // UMA interpolacao por script, e os QUATRO consumidores saem dela: a previa
  // pintada abaixo, o Copiar, o link do wa.me e — desde o Plano 11 — a decisao
  // de habilitar o envio (`pendencias.lacunas`). Nao existe segundo caminho de
  // render que possa divergir; em particular, a habilitacao do botao NAO pode
  // sair de uma segunda contagem propria, senao a tela poderia oferecer envio
  // para um texto que a previa mostra com buraco.
  const segmentos = interpolar(script.conteudo, contexto)
  const texto = textoPlano(segmentos)
  const pendencias = contarPendencias(segmentos)

  // O snapshot da submissao contra a traducao do conteudo ATUAL, pela mesma
  // funcao que a Server Action usa para recusar (scripts/desatualizado.ts).
  const desatualizado = template !== null && estaDesatualizado(script.conteudo, template)
  // Sem template aprovado nao ha o que enviar, e sem telefone o botao nem
  // aparece — o wa.me ao lado ja explica esse estado com o proprio controle
  // desabilitado, e dois botoes mortos dizendo a mesma coisa e' ruido.
  const podeOferecerEnvio =
    template !== null && template.status === 'approved' && telefoneE164 !== null

  // Motivo do bloqueio nas MESMAS frases dos codigos que a action devolveria: a
  // tela nao inventa vocabulario proprio para o mesmo fato. Desatualizado vem
  // primeiro porque e' o bloqueio mais estrutural — com o script mudado, nao ha
  // envio possivel nem preenchendo a lacuna.
  const motivoBloqueio = desatualizado
    ? mensagemDeErroScript('template_desatualizado')
    : pendencias.lacunas > 0
      ? mensagemDeErroScript('whatsapp_lacunas')
      : null

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
    }, DURACAO_FEEDBACK_MS)
  }

  async function confirmarEnvio() {
    // Trava sincrona ANTES de qualquer await — ver o comentario de
    // `envioEmCurso`. `setEnviando` continua existindo para a UI (o botao
    // desabilitado e o "aguarde" visual), mas quem impede a segunda mensagem
    // e' a ref.
    if (envioEmCurso.current) return
    envioEmCurso.current = true
    setEnviando(true)
    setErroEnvio(null)
    // A action recebe SO os dois ids: quem resolve o template, o corpo e os
    // valores e' o servidor, na conta ativa. Nada do que esta pintado nesta
    // tela viaja para o Graph.
    const r = await chamarAcao(enviar(leadId, script.id))
    // Solta a trava no fim da chamada, com sucesso ou falha: uma recusa
    // (`envio_recusado`, lacuna que apareceu no meio) tem que poder ser
    // retentada depois de o usuario corrigir o que for.
    envioEmCurso.current = false
    setEnviando(false)
    setConfirmando(false)
    if (!r.ok) {
      setErroEnvio(mensagemDeErroScript(r.erro))
      return
    }
    if (timeoutEnviado.current) clearTimeout(timeoutEnviado.current)
    setEnviado(true)
    timeoutEnviado.current = setTimeout(() => {
      setEnviado(false)
      timeoutEnviado.current = null
    }, DURACAO_FEEDBACK_MS)
  }

  return (
    <li className="flex flex-col gap-2 rounded border border-border p-2">
      <h3 className="text-sm font-medium">{script.titulo}</h3>

      <div
        role="region"
        aria-label={`Prévia de ${script.titulo}`}
        className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-sm"
      >
        {/* Mesma marca do editor, pelo mesmo motivo — pintura compartilhada
            via <PreviaSegmentos> (Plano 13, Task 2): a tag literal continua
            no texto (lacuna invisivel = mensagem com buraco enviada de
            verdade), e o rotulo vai num <span> escondido DENTRO da marca —
            <mark> tem papel ARIA name-prohibited, entao um aria-label nela
            nao chega a leitor de tela nenhum. */}
        <PreviaSegmentos segmentos={segmentos} />
      </div>

      {/* O contador e' o AVISO para copiar/wa.me, nao um bloqueio: os dois
          continuam liberados com pendencia (spec §4.4) — quem decide mandar
          assim mesmo e' o vendedor, que esta olhando o lead. O ENVIO por
          template e' outra historia: o Meta exige um valor por posicao, e um
          slot vazio nao e' "mensagem com buraco", e' mensagem recusada ou
          desalinhada. Por isso a lacuna bloqueia so o botao de enviar. */}
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

      {/* Texto visivel, e nao so' o `title` do botao: title nao aparece em
          toque nem para quem navega o texto com leitor de tela. A MESMA string
          do title (e da action, e de /scripts/[id]), lida do mapa: duas
          redacoes do mesmo fato na mesma tela fazem o leitor procurar a
          diferenca que nao existe. A frase pede uma acao que o vendedor nao
          executa — quem re-submete e' admin/gestor —, e continua sendo a
          instrucao certa: e' o que ele precisa pedir para voltar a enviar. */}
      {podeOferecerEnvio && desatualizado && (
        <p className="text-xs text-warning">
          {mensagemDeErroScript('template_desatualizado')}
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

        {podeOferecerEnvio && (
          <button
            type="button"
            onClick={() => {
              // Um erro de tentativa anterior nao pode sobreviver a abertura de
              // um dialogo novo, como se fizesse parte dele — mesma disciplina
              // de reportarErro em config/etapas.tsx.
              setErroEnvio(null)
              setConfirmando(true)
            }}
            disabled={motivoBloqueio !== null || enviando}
            title={motivoBloqueio ?? undefined}
            className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
          >
            Enviar WhatsApp
          </button>
        )}

        {/* Fora dos botoes de proposito: o nome acessivel do "Copiar" e do
            "Enviar WhatsApp" nao pode mudar depois do primeiro uso, senao quem
            navega por teclado perde o alvo. role="status" da o aria-live polite
            que anuncia a mudanca. */}
        {copiado && (
          <span role="status" className="text-xs text-success">
            Copiado ✓
          </span>
        )}
        {enviado && (
          <span role="status" className="text-xs text-success">
            Enviado ✓
          </span>
        )}
      </div>

      {/* Confirmacao inline, mesmo desenho do dialogo de desconexao em
          config/whatsapp.tsx. Existe porque isto NAO e' um rascunho: o clique
          manda uma mensagem de verdade, agora, para o telefone do cliente — e
          o Meta cobra por ela. */}
      {confirmando && (
        <div
          role="dialog"
          aria-label="Enviar WhatsApp"
          className="flex flex-col gap-2 rounded border border-border p-2 text-sm"
        >
          <p>Enviar esta mensagem para o cliente agora?</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void confirmarEnvio()}
              disabled={enviando}
              aria-label="Confirmar envio"
              className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
            >
              Confirmar envio
            </button>
            <button
              type="button"
              onClick={() => {
                setErroEnvio(null)
                setConfirmando(false)
              }}
              aria-label="Cancelar envio"
              className="rounded border border-border px-2 py-1 text-xs"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {erroCopia && <p className="text-xs text-destructive">{erroCopia}</p>}
      {erroEnvio && <p className="text-xs text-destructive">{erroEnvio}</p>}
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
 *
 * `templates` chega como LISTA e e' indexada aqui por `scriptId`: a pagina faz
 * uma consulta so (`dosScripts`) para os N scripts do painel, em vez de uma por
 * item. Lista vazia e' o estado normal de quem nunca submeteu template — e
 * tambem o estado degradado quando a leitura falha, porque sem template so' se
 * perde o botao de enviar, e a ficha continua de pe.
 */
export function PainelScripts({
  scripts,
  contexto,
  telefoneE164,
  leadId,
  templates = [],
  erro = null,
  enviar = enviarWhatsApp,
}: {
  scripts: Script[]
  contexto: ContextoScript
  telefoneE164: string | null
  leadId: string
  templates?: TemplateWhatsApp[]
  erro?: string | null
  enviar?: AcaoEnviar
}) {
  const porScript = new Map(templates.map((t) => [t.scriptId, t]))

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
              leadId={leadId}
              template={porScript.get(s.id) ?? null}
              enviar={enviar}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
