'use client'

import { useState } from 'react'
import Link from 'next/link'
// Type-only: `import type` some na compilacao, entao lib/data/templates (e o
// next/headers que ele arrasta por baixo) nunca entra no bundle do browser.
import type { TemplateWhatsApp as Template } from '@/lib/data/templates'
import type { Resultado } from '@/lib/domain/resultado'
import { chamarAcao } from '@/lib/ui/acao'
import { excluirTemplate, submeterTemplate } from './acoes-template'
import { mensagemDeErroScript } from './erros'

type AcaoSubmeter = (
  scriptId: string,
  categoria: 'marketing' | 'utility',
) => Promise<Resultado<void>>

type AcaoExcluir = (scriptId: string) => Promise<Resultado<void>>

/** Estado em que o Meta ainda pode mudar de ideia: nada de re-submeter por
 * cima, porque a action recusa (template_ja_pendente) e o botao so existiria
 * para dar erro. */
const EM_ANALISE = 'pending'

const ROTULOS: Record<string, string> = {
  pending: 'Em análise',
  approved: 'Aprovado',
  rejected: 'Recusado',
}

/**
 * Rotulo do chip. Status desconhecido (o Meta tem outros estados e inventa
 * mais) aparece CRU, e nao traduzido para o mais parecido: dizer "Aprovado"
 * para 'paused' seria a tela mentindo sobre a unica coisa que decide se da'
 * para enviar. `hasOwnProperty.call` pelo mesmo motivo de erros.ts — o indice
 * cru acharia 'toString' herdado de Object.prototype e o React receberia uma
 * funcao onde espera texto.
 */
function rotuloDoStatus(status: string): string {
  return Object.prototype.hasOwnProperty.call(ROTULOS, status) ? ROTULOS[status] : status
}

const MINUTO = 60 * 1000
const HORA = 60 * MINUTO
const DIA = 24 * HORA

function plural(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`
}

/**
 * "há 2 horas" a partir de `statusConsultadoEm`. Recebe `agora` por parametro,
 * como PainelTarefas: relogio lido dentro do componente e' teste que muda de
 * resultado conforme a hora em que roda.
 */
function tempoDesde(quando: Date, agora: Date): string {
  const ms = agora.getTime() - quando.getTime()
  if (ms < MINUTO) return 'há menos de um minuto'
  if (ms < HORA) return `há ${plural(Math.floor(ms / MINUTO), 'minuto', 'minutos')}`
  if (ms < DIA) return `há ${plural(Math.floor(ms / HORA), 'hora', 'horas')}`
  return `há ${plural(Math.floor(ms / DIA), 'dia', 'dias')}`
}

/**
 * Bloco de template do WhatsApp em /scripts/[id]. Action por prop com default,
 * mesmo padrao de whatsapp.tsx e editor.tsx — e' o que torna os quatro estados
 * testaveis sem servidor.
 *
 * Quem gateia por papel e' a pagina: /scripts/[id] ja responde notFound() para
 * vendedor antes de renderizar qualquer coisa.
 */
export function TemplateWhatsApp({
  scriptId,
  template,
  desatualizado,
  semConexao,
  agora,
  submeter = submeterTemplate,
  excluir = excluirTemplate,
}: {
  scriptId: string
  template: Template | null
  /** `traduzirParaPosicional(conteudo atual)` ≠ snapshot gravado. Calculado no
   * servidor, onde o conteudo atual e o snapshot existem lado a lado. */
  desatualizado: boolean
  semConexao: boolean
  /** OBRIGATORIO, e nunca `= new Date()` como default aqui: o relogio do SSR e
   * o da hidratacao sao instantes diferentes, e "Consultado ha 3 minutos"
   * renderizado no servidor viraria "ha 4 minutos" no cliente — mismatch de
   * hidratacao. Quem carimba e' a pagina, uma vez, e o valor viaja no payload.
   * Mesmo contrato de PainelTarefas e da Lista de tarefas. */
  agora: Date
  submeter?: AcaoSubmeter
  excluir?: AcaoExcluir
}) {
  const [categoria, setCategoria] = useState<'marketing' | 'utility'>('marketing')
  const [pendente, setPendente] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false)

  // Re-submissao reusa a categoria com que o template ja foi registrado: mudar
  // de marketing para utility no meio do caminho e' outra decisao, e ela cabe
  // numa submissao do zero (exclua e submeta), nao num botao chamado
  // "re-submeter".
  const categoriaAEnviar = template ? template.categoria : categoria

  async function submeterClique() {
    if (pendente) return
    setPendente(true)
    setErro(null)
    const r = await chamarAcao(submeter(scriptId, categoriaAEnviar))
    setPendente(false)
    if (!r.ok) setErro(mensagemDeErroScript(r.erro))
  }

  async function confirmarExclusao() {
    if (pendente) return
    setPendente(true)
    setErro(null)
    const r = await chamarAcao(excluir(scriptId))
    setPendente(false)
    setConfirmandoExclusao(false)
    if (!r.ok) setErro(mensagemDeErroScript(r.erro))
  }

  const emAnalise = template !== null && template.status === EM_ANALISE
  // Submeter existe quando nao ha template; re-submeter, quando o que existe
  // nao serve mais (recusado, desatualizado, ou num estado que nao e enviavel)
  // — nunca durante a analise.
  const podeSubmeter =
    template === null ||
    (!emAnalise && (desatualizado || template.status !== 'approved'))

  /**
   * A linha que aponta para /config substitui SO a area de submissao, e nunca o
   * bloco inteiro. Sem conexao pode ser falha transitoria da RPC de credencial
   * (a pagina nao distingue), e engolir o bloco todo diria "conecte um numero"
   * a quem tem um template APROVADO — sumindo com o chip e com o nome no Meta,
   * que sao fatos gravados no banco e continuam verdadeiros com o Meta fora do
   * ar. O que de fato nao da' para fazer sem credencial e' submeter.
   */
  const linhaSemConexao = (
    <p className="text-sm text-muted-foreground">
      Conecte um número de WhatsApp em{' '}
      <Link href="/config" className="underline">
        Configuração
      </Link>{' '}
      para submeter este script como template.
    </p>
  )

  return (
    <section className="flex flex-col gap-3 rounded border p-4">
      <h2 className="font-medium">Template do WhatsApp</h2>

      {template && (
        <div className="flex flex-col gap-1 text-sm">
          <div className="flex items-center gap-2">
            <span className="rounded border px-2 py-0.5 text-xs">
              {rotuloDoStatus(template.status)}
            </span>
            <span className="text-xs text-muted-foreground">{template.nomeMeta}</span>
          </div>

          {emAnalise && (
            <p className="text-xs text-muted-foreground">
              {template.statusConsultadoEm
                ? `Consultado ${tempoDesde(template.statusConsultadoEm, agora)}.`
                : 'Ainda não consultado.'}
            </p>
          )}

          {template.motivoRejeicao && (
            <p className="text-sm text-destructive">{template.motivoRejeicao}</p>
          )}
        </div>
      )}

      {template && desatualizado && (
        <p className="text-sm">O script mudou desde a submissão — re-submeta para atualizar</p>
      )}

      {/* Excluir e' o caminho para trocar a categoria (submissao do zero).
          Fora do gate de semConexao, de proposito: a exclusao comeca no banco
          e a limpeza na WABA e' best-effort da action — sem credencial ela
          continua valendo. */}
      {template && !confirmandoExclusao && (
        <button
          type="button"
          onClick={() => setConfirmandoExclusao(true)}
          disabled={pendente}
          className="w-fit rounded border border-destructive px-3 py-1 text-sm text-destructive disabled:opacity-50"
        >
          Excluir template
        </button>
      )}

      {template && confirmandoExclusao && (
        <div
          role="dialog"
          aria-label="Excluir template"
          className="flex flex-col gap-2 rounded border p-3 text-sm"
        >
          <p>
            Excluir o template &quot;{template.nomeMeta}&quot;?
            {/* Excluir + submeter do zero contorna o template_ja_pendente em
                dois cliques — legitimo, desde que o abandono da analise seja
                consciente. */}
            {emAnalise && ' Este template ainda está em análise no Meta — excluir abandona a análise.'}{' '}
            Enviar este script por WhatsApp vai exigir nova submissão e aprovação do Meta.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void confirmarExclusao()}
              disabled={pendente}
              aria-label="Confirmar exclusão do template"
              className="rounded bg-destructive px-3 py-1 text-primary-foreground disabled:opacity-50"
            >
              Confirmar exclusão
            </button>
            <button
              type="button"
              onClick={() => setConfirmandoExclusao(false)}
              aria-label="Cancelar exclusão do template"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {semConexao && linhaSemConexao}

      {!semConexao && podeSubmeter && (
        <div className="flex flex-col gap-2">
          {template === null && (
            <>
              <label className="flex w-fit flex-col text-sm">
                Categoria
                <select
                  value={categoria}
                  onChange={(e) => setCategoria(e.target.value as 'marketing' | 'utility')}
                  className="rounded border px-2 py-1"
                >
                  <option value="marketing">Marketing</option>
                  <option value="utility">Utilidade</option>
                </select>
              </label>
              <p className="text-xs text-muted-foreground">
                Marketing é oferta e novidade; utilidade é aviso sobre algo que o lead já pediu — o
                Meta cobra e aprova as duas de forma diferente.
              </p>
            </>
          )}
          <button
            type="button"
            onClick={() => void submeterClique()}
            disabled={pendente}
            className="w-fit rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            {template === null ? 'Submeter ao WhatsApp' : 'Re-submeter ao WhatsApp'}
          </button>
        </div>
      )}

      {erro && <p className="text-sm text-destructive">{erro}</p>}
    </section>
  )
}
