'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Check } from 'lucide-react'
// Type-only: `import type` some na compilacao, entao lib/data/templates (e o
// next/headers que ele arrasta por baixo) nunca entra no bundle do browser.
import type { TemplateWhatsApp } from '@/lib/data/templates'
import type { Resultado } from '@/lib/domain/resultado'
import { contarPendencias, interpolar } from '@/lib/domain/script'
import { chamarAcao } from '@/lib/ui/acao'
import { estaDesatualizado } from '@/app/(app)/scripts/desatualizado'
import { mensagemDeErroScript } from '@/app/(app)/scripts/erros'
import { PreviaSegmentos } from '@/app/(app)/scripts/previa'
// 'use server': enviarWhatsApp e' a MESMA action da ficha do lead — nenhuma
// action de envio nova, todas as guardas do Plano 11 vem com ela.
import { enviarWhatsApp } from '@/app/(app)/funil/drawer/acoes-whatsapp'
import { buscarLeadsParaDisparo, type LeadParaDisparo } from './acoes'

/** Quanto tempo o "Enviado ✓" fica visivel — mesma duracao e mesmo motivo do
 * "Copiado ✓"/"Enviado ✓" de funil/drawer/scripts.tsx: um sinal transitorio que
 * fica colado na tela passa a acompanhar eventos que nao sao dele. */
const DURACAO_FEEDBACK_MS = 2_500

export type ScriptParaDisparo = {
  id: string
  titulo: string
  conteudo: string
  /** null = nunca submetido. A pagina monta esta lista com `dosScripts` — uma
   * consulta so para todos os scripts da conta, nao uma por item. */
  template: TemplateWhatsApp | null
}

type AcaoBuscarLeads = (termo: string) => Promise<Resultado<LeadParaDisparo[]>>
type AcaoEnviar = (leadId: string, scriptId: string) => Promise<Resultado<void>>

/** Motivo do bloqueio de um script, nas MESMAS frases que a action recusaria
 * (mensagemDeErroScript) — a tela nao inventa vocabulario proprio para o
 * mesmo fato. 'Sem template' e' o unico texto proprio (o brief pede essa
 * frase exata: nao ha codigo de erro para "nunca submetido"). */
function statusDoScript(s: ScriptParaDisparo): { selecionavel: boolean; motivo: string | null } {
  if (s.template === null) {
    return { selecionavel: false, motivo: 'Sem template — submeta no editor' }
  }
  if (estaDesatualizado(s.conteudo, s.template)) {
    return { selecionavel: false, motivo: mensagemDeErroScript('template_desatualizado') }
  }
  if (s.template.status !== 'approved') {
    return { selecionavel: false, motivo: mensagemDeErroScript('template_nao_aprovado') }
  }
  return { selecionavel: true, motivo: null }
}

/**
 * Area "Disparar" no topo de /disparo (Task 7): escolher script, buscar lead,
 * ver a previa interpolada e enviar — sem abrir a ficha.
 *
 * Actions por prop com default, mesmo padrao de template-whatsapp.tsx e
 * funil/drawer/scripts.tsx — e' o que torna os tres passos testaveis sem
 * servidor.
 */
export function Disparar({
  scripts,
  podeEditar,
  buscarLeads = buscarLeadsParaDisparo,
  enviar = enviarWhatsApp,
}: {
  scripts: ScriptParaDisparo[]
  /** Mesmo `papel !== 'vendedor'` que a biblioteca (page.tsx) ja usa para
   * decidir o link/titulo de `ListaDeScripts` — sem prop nenhuma, SEM
   * default: `/scripts/[id]` responde notFound() para vendedor (ver
   * lista.tsx), e oferecer o link aqui seria oferecer um caminho que a
   * rota nao cumpre — a mesma decisao, so' que duplicada num segundo lugar
   * da tela que tambem lista script. */
  podeEditar: boolean
  buscarLeads?: AcaoBuscarLeads
  enviar?: AcaoEnviar
}) {
  const [scriptId, setScriptId] = useState<string | null>(null)
  const [termo, setTermo] = useState('')
  const [leads, setLeads] = useState<LeadParaDisparo[]>([])
  const [buscando, setBuscando] = useState(false)
  const [erroBusca, setErroBusca] = useState<string | null>(null)
  const [leadId, setLeadId] = useState<string | null>(null)

  const [enviando, setEnviando] = useState(false)
  const [enviado, setEnviado] = useState(false)
  const [leadEnviadoId, setLeadEnviadoId] = useState<string | null>(null)
  const [erroEnvio, setErroEnvio] = useState<string | null>(null)
  const timeoutEnviado = useRef<ReturnType<typeof setTimeout> | null>(null)
  /**
   * Trava do envio em curso. Ref, e NAO o `enviando` do estado: dois cliques
   * no mesmo frame leem o mesmo valor de closure (`false` nos dois) e o
   * `disabled={enviando}` do DOM so vale depois do re-render — o guard por
   * estado deixa passar os dois, e aqui isso custa DUAS mensagens enviadas e
   * cobradas pelo Meta. Copiado de funil/drawer/scripts.tsx:57-64.
   */
  const envioEmCurso = useRef(false)

  useEffect(() => {
    return () => {
      if (timeoutEnviado.current) clearTimeout(timeoutEnviado.current)
    }
  }, [])

  const script = scripts.find((s) => s.id === scriptId) ?? null
  const lead = leads.find((l) => l.id === leadId) ?? null

  // UMA interpolacao, e o preview e a decisao de bloqueio saem dela — nao ha
  // segunda contagem propria que possa divergir do que a tela pinta.
  const segmentos = script && lead ? interpolar(script.conteudo, lead.contexto) : []
  const pendencias = contarPendencias(segmentos)

  const podeEnviar =
    script !== null && lead !== null && lead.telefoneE164 !== null && pendencias.lacunas === 0

  const motivoBloqueio =
    lead && lead.telefoneE164 === null
      ? 'Este lead não tem telefone'
      : pendencias.lacunas > 0
        ? mensagemDeErroScript('whatsapp_lacunas')
        : null

  async function buscar(e: React.FormEvent) {
    e.preventDefault()
    setBuscando(true)
    setErroBusca(null)
    setLeadId(null)
    const r = await chamarAcao(buscarLeads(termo))
    setBuscando(false)
    if (!r.ok) {
      setErroBusca(mensagemDeErroScript(r.erro))
      setLeads([])
      return
    }
    setLeads(r.valor)
  }

  async function enviarClique() {
    // Trava sincrona ANTES de qualquer await — ver o comentario de
    // `envioEmCurso`.
    if (envioEmCurso.current) return
    if (!script || !lead) return
    envioEmCurso.current = true
    setEnviando(true)
    setErroEnvio(null)
    const idDoLead = lead.id
    const r = await chamarAcao(enviar(idDoLead, script.id))
    envioEmCurso.current = false
    setEnviando(false)
    if (!r.ok) {
      setErroEnvio(mensagemDeErroScript(r.erro))
      return
    }
    if (timeoutEnviado.current) clearTimeout(timeoutEnviado.current)
    setLeadEnviadoId(idDoLead)
    setEnviado(true)
    // De-arma o envio: sem lead selecionado, a secao com o botao (que exige
    // `lead` nao-nulo) some ate o usuario escolher de novo — uma segunda
    // mensagem cobrada pelo Meta exige um clique deliberado, nao um segundo
    // clique acidental em cima da mesma previa.
    setLeadId(null)
    timeoutEnviado.current = setTimeout(() => {
      setEnviado(false)
      timeoutEnviado.current = null
    }, DURACAO_FEEDBACK_MS)
  }

  return (
    <div className="surface flex flex-col gap-4 rounded-2xl p-5">
      <h2 className="text-lg font-semibold">Disparar</h2>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Passo 1 — Escolher script</h3>
        {scripts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum script para disparar ainda — escreva um na biblioteca abaixo.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {scripts.map((s) => {
              const { selecionavel, motivo } = statusDoScript(s)
              return (
                <li key={s.id} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setScriptId(s.id)
                        setErroEnvio(null)
                      }}
                      disabled={!selecionavel}
                      aria-pressed={scriptId === s.id}
                      className="pressable inline-flex shrink-0 items-center justify-center gap-2 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 h-8 rounded-lg border border-border px-3 text-[13px] hover:bg-accent"
                    >
                      {s.titulo}
                    </button>
                    {/* podeEditar gateia o link, nunca o motivo: vendedor
                        precisa saber POR QUE o script esta bloqueado, so
                        nao ganha um caminho para /scripts/[id] que a rota
                        recusaria com notFound(). */}
                    {!selecionavel && podeEditar && (
                      <Link href={`/scripts/${s.id}`} className="text-xs underline">
                        Ver {s.titulo}
                      </Link>
                    )}
                  </div>
                  {motivo && <p className="text-xs text-warning">{motivo}</p>}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {script && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Passo 2 — Buscar lead</h3>
          <form onSubmit={(e) => void buscar(e)} className="flex items-end gap-2">
            <div className="flex flex-col text-sm">
              <label htmlFor="disparo-busca-lead">Buscar lead</label>
              <input
                id="disparo-busca-lead"
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
                placeholder="nome, telefone ou email"
                className="rounded-lg border border-border bg-muted/40 px-2.5 py-1.5"
              />
            </div>
            <button
              type="submit"
              disabled={buscando}
              className="rounded border border-border px-3 py-1 text-sm disabled:opacity-50"
            >
              Buscar
            </button>
          </form>

          {erroBusca && <p className="text-sm text-destructive">{erroBusca}</p>}

          {leads.length > 0 && (
            <ul className="flex flex-col gap-1">
              {leads.map((l) => (
                <li key={l.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setLeadId(l.id)
                      // Erro do envio anterior era do lead que estava
                      // selecionado antes — trocar de lead sem reenviar nao
                      // pode deixar esse erro colado sob a previa de outro.
                      setErroEnvio(null)
                    }}
                    disabled={l.telefoneE164 === null}
                    title={l.telefoneE164 === null ? 'Este lead não tem telefone' : undefined}
                    aria-pressed={leadId === l.id}
                    className="pressable inline-flex shrink-0 items-center justify-center gap-2 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 h-8 rounded-lg border border-border px-3 text-[13px] hover:bg-accent"
                  >
                    {l.nome}
                  </button>
                  <span className="text-xs text-muted-foreground">
                    {l.etapa ?? 'Sem etapa'}
                  </span>
                  {l.telefoneE164 === null && (
                    <span className="text-xs text-warning">Este lead não tem telefone</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* A confirmacao de sucesso (Enviado ✓ / Ver na ficha) NAO depende de
          `lead`: um envio bem-sucedido limpa `leadId` (ver enviarClique) para
          de-armar um segundo clique, mas a confirmacao do envio que acabou de
          sair tem que continuar visivel mesmo sem lead selecionado. */}
      {script && (lead || (enviado && leadEnviadoId)) && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Passo 3 — Prévia e envio</h3>
          {lead && (
            <div
              role="region"
              aria-label={`Prévia para ${lead.nome}`}
              className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-sm"
            >
              <PreviaSegmentos segmentos={segmentos} />
            </div>
          )}

          {lead && motivoBloqueio && <p className="text-xs text-warning">{motivoBloqueio}</p>}

          <div className="flex items-center gap-2">
            {lead && (
              <button
                type="button"
                onClick={() => void enviarClique()}
                disabled={!podeEnviar || enviando}
                title={motivoBloqueio ?? undefined}
                className="pressable inline-flex shrink-0 items-center justify-center gap-2 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 h-10 rounded-xl bg-primary px-4 text-sm text-primary-foreground shadow-sm hover:brightness-110"
              >
                Enviar WhatsApp
              </button>
            )}

            {enviado && leadEnviadoId && (
              <span role="status" className="inline-flex items-center gap-1.5 text-sm text-success">
                <Check size={15} strokeWidth={2.5} aria-hidden="true" />
                Enviado{' '}
                <Link href={`/leads/${leadEnviadoId}`} className="underline">
                  Ver na ficha
                </Link>
              </span>
            )}
          </div>

          {lead && erroEnvio && <p className="text-sm text-destructive">{erroEnvio}</p>}
        </section>
      )}
    </div>
  )
}
