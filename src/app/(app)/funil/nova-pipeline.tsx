'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, Plus } from 'lucide-react'
import { Botao } from '@/components/ui/botao'
import type { Resultado } from '@/lib/domain/resultado'
import { chamarAcao } from '@/lib/ui/acao'
import { criarPipelineAction } from './acoes-pipelines'
import { mensagemDePipeline } from './erros'

type AcaoCriar = (formData: FormData) => Promise<Resultado<string>>

/** As 5 etapas sugeridas ao abrir o modal — o usuario pode renomear, remover
 * (ate sobrar 1) ou adicionar mais. Ganho e Perdido nao entram aqui: a
 * action (criarPipelineAction / store.criarPipeline) as adiciona sozinha ao
 * final, e o texto fixo do modal avisa isso. */
const ETAPAS_SUGERIDAS = ['Novo lead', 'Contato feito', 'Qualificação', 'Proposta', 'Fechamento']

let proximoIdDeLinha = 0
function idDeLinha(): string {
  proximoIdDeLinha += 1
  return `etapa-${proximoIdDeLinha}`
}

type LinhaDeEtapa = { id: string; valor: string }

function etapasIniciais(): LinhaDeEtapa[] {
  return ETAPAS_SUGERIDAS.map((valor) => ({ id: idDeLinha(), valor }))
}

/**
 * Botão «+ Nova pipeline» + modal de criação (Task 6): nome + lista de
 * etapas abertas reordenável, autocontidos — Task 7 so' renderiza
 * `<NovaPipeline />` na coluna da barra, logo abaixo de `<BarraPipelines />`.
 *
 * `etapas` viaja para a action como UM campo de FormData com um array JSON
 * na ordem visual — mesma tecnica que acoes-pipelines.ts (Task 4) espera
 * (etapasDoFormData). O nome do campo continua nativo (`name="nome"`) e sai
 * direto do FormData que o `action` do form ja monta; so' `etapas` precisa
 * ser injetado a mao porque nao existe um unico input nativo para uma lista
 * de tamanho variavel.
 *
 * Action por prop com default, mesmo padrao de barra-pipelines.tsx /
 * disparar.tsx: testavel sem servidor.
 */
export function NovaPipeline({ criar = criarPipelineAction }: { criar?: AcaoCriar }) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [nome, setNome] = useState('')
  const [etapas, setEtapas] = useState<LinhaDeEtapa[]>(etapasIniciais)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  /**
   * Trava do submit em curso. Ref, e NAO o `salvando` do estado — mesmo
   * motivo de `envioEmCurso` em disparo/disparar.tsx: dois cliques no mesmo
   * frame leem o mesmo `false` de closure, e o `disabled={salvando}` do DOM
   * so' vale depois do re-render. So' a trava sincrona por ref impede duas
   * pipelines criadas por um clique duplo.
   */
  const salvandoRef = useRef(false)

  function abrir() {
    setErro(null)
    setAberto(true)
  }

  /** Fecha e restaura os defaults — usada em sucesso e em cancelar. NAO e'
   * chamada no caminho de erro: o modal continua aberto com o que foi
   * digitado (etapas inclusas, ja que moram no estado deste componente). */
  function fecharERestaurar() {
    setAberto(false)
    setErro(null)
    setNome('')
    setEtapas(etapasIniciais())
  }

  function mudarEtapa(id: string, valor: string) {
    setEtapas((atual) => atual.map((e) => (e.id === id ? { ...e, valor } : e)))
  }

  function adicionarEtapa() {
    setEtapas((atual) => [...atual, { id: idDeLinha(), valor: '' }])
  }

  function removerEtapa(id: string) {
    setEtapas((atual) => (atual.length <= 1 ? atual : atual.filter((e) => e.id !== id)))
  }

  function moverEtapa(id: string, direcao: -1 | 1) {
    setEtapas((atual) => {
      const index = atual.findIndex((e) => e.id === id)
      const alvo = index + direcao
      if (index < 0 || alvo < 0 || alvo >= atual.length) return atual
      const copia = atual.slice()
      const [linha] = copia.splice(index, 1)
      copia.splice(alvo, 0, linha)
      return copia
    })
  }

  async function salvar(formData: FormData) {
    if (salvandoRef.current) return
    salvandoRef.current = true
    setSalvando(true)
    formData.set('etapas', JSON.stringify(etapas.map((e) => e.valor)))
    const r = await chamarAcao(criar(formData))
    salvandoRef.current = false
    setSalvando(false)
    if (!r.ok) {
      setErro(mensagemDePipeline(r.erro))
      return
    }
    fecharERestaurar()
    router.push(`/funil?pipeline=${r.valor}`)
  }

  if (!aberto) {
    return (
      // O "+" textual virou <Plus> aria-hidden, entao o nome acessivel do
      // botao passou de "+ Nova pipeline" para "Nova pipeline" — os tres
      // seletores que o casavam com `exact: true` (pipelines.spec.ts,
      // etapas-membro.spec.ts, nova-pipeline.test.tsx) foram atualizados
      // junto. w-full para empilhar com "Editar etapas" logo abaixo, na
      // coluna de 224px.
      <Botao type="button" onClick={abrir} className="w-full">
        <Plus size={16} strokeWidth={2.25} aria-hidden="true" />
        Nova pipeline
      </Botao>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="surface fade-in w-full max-w-md rounded-3xl p-6">
        <h2 className="mb-3 text-lg font-semibold">Nova pipeline</h2>
        <form action={salvar} className="flex flex-col gap-3">
          <label className="text-sm">
            Nome da pipeline
            {/* Controlado, ao contrario do input equivalente em novo-lead.tsx
                / barra-pipelines.tsx: o React reseta os campos NAO
                controlados de um <form action={fn}> assim que a action
                termina, sucesso ou erro — sem estado proprio o texto digitado
                sumiria bem no caso em que o brief exige mante-lo (erro). */}
            <input
              name="nome"
              required
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="mt-1 h-10 w-full rounded-xl border border-border bg-muted/60 px-3 text-sm text-foreground placeholder:text-muted-foreground/70 transition-colors focus:border-primary focus:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:opacity-50"
            />
          </label>

          <div className="flex flex-col gap-1">
            {etapas.map((etapa, index) => {
              const rotulo = etapa.valor.trim() || `etapa ${index + 1}`
              return (
                <div key={etapa.id} className="flex items-center gap-1">
                  <input
                    aria-label={`Nome da etapa ${index + 1}`}
                    value={etapa.valor}
                    onChange={(e) => mudarEtapa(etapa.id, e.target.value)}
                    className="flex-1 rounded border p-1 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => moverEtapa(etapa.id, -1)}
                    disabled={index === 0}
                    aria-label={`Mover ${rotulo} para cima`}
                    className="pressable rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                  >
                    <ArrowUp size={14} strokeWidth={2} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moverEtapa(etapa.id, 1)}
                    disabled={index === etapas.length - 1}
                    aria-label={`Mover ${rotulo} para baixo`}
                    className="pressable rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                  >
                    <ArrowDown size={14} strokeWidth={2} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removerEtapa(etapa.id)}
                    disabled={etapas.length <= 1}
                    aria-label={`Remover ${rotulo}`}
                    className="rounded px-1.5 py-1 text-sm text-destructive disabled:opacity-30"
                  >
                    Remover
                  </button>
                </div>
              )
            })}
          </div>

          <button
            type="button"
            onClick={adicionarEtapa}
            className="self-start rounded px-2 py-1 text-sm text-primary hover:underline"
          >
            + Adicionar etapa
          </button>

          <p className="text-xs text-muted-foreground">
            Ganho e Perdido serão adicionadas ao final automaticamente.
          </p>

          {erro && <p className="text-sm text-destructive">{erro}</p>}

          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={fecharERestaurar} className="px-3 py-1 text-sm">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={salvando}
              className="pressable inline-flex shrink-0 items-center justify-center gap-2 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 h-10 rounded-xl bg-primary px-4 text-sm text-primary-foreground shadow-sm hover:brightness-110"
            >
              Salvar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
