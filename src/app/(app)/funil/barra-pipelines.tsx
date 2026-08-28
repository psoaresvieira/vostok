'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { EllipsisVertical, Pencil, Trash2 } from 'lucide-react'
import type { Pipeline } from '@/lib/domain/tipos'
import type { Resultado } from '@/lib/domain/resultado'
import { chamarAcao } from '@/lib/ui/acao'
import { Botao } from '@/components/ui/botao'
import { Campo, Rotulo } from '@/components/ui/campo'
import { Modal, AcoesDoModal } from '@/components/ui/modal'
import { renomearPipelineAction, excluirPipelineAction } from './acoes-pipelines'
import { mensagemDePipeline } from './erros'
import { hrefDoFunil } from './params'

type AcaoRenomear = (pipelineId: string, nome: string) => Promise<Resultado<void>>
type AcaoExcluir = (pipelineId: string) => Promise<Resultado<void>>

/**
 * Coluna lateral do funil (Task 5): navegacao entre pipelines + kebab por
 * item com renomear/excluir. NAO conhece o modal de criacao («+ Nova
 * pipeline» e' da Task 6, montado pela pagina — Task 7 — logo abaixo desta
 * barra na mesma coluna).
 *
 * Continua sendo um painel PROPRIO, e nao itens dentro da barra lateral
 * global: os hrefs daqui dependem de `queryAtual` (os searchParams do funil),
 * e um layout do Next nao recebe searchParams. Movida para la, a barra
 * perderia a preservacao de filtros ao trocar de pipeline — o funil voltaria
 * para "todos os leads" a cada clique. E' o mesmo arranjo de dois niveis do
 * print de referencia: navegacao global na barra escura, contexto da tela na
 * coluna ao lado.
 *
 * Actions por prop com default, mesmo padrao de disparar.tsx: testavel sem
 * servidor, e a pagina real usa as actions de verdade sem precisar passar
 * nada.
 */
export function BarraPipelines({
  pipelines,
  pipelineAtivaId,
  queryAtual,
  renomear = renomearPipelineAction,
  excluir = excluirPipelineAction,
}: {
  pipelines: Pipeline[]
  pipelineAtivaId: string
  queryAtual: string
  renomear?: AcaoRenomear
  excluir?: AcaoExcluir
}) {
  const router = useRouter()
  const [menuAbertoId, setMenuAbertoId] = useState<string | null>(null)
  const [renomeando, setRenomeando] = useState<Pipeline | null>(null)
  const [excluindo, setExcluindo] = useState<Pipeline | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [excluindoEmCurso, setExcluindoEmCurso] = useState(false)

  function abrirRenomear(pipeline: Pipeline) {
    setMenuAbertoId(null)
    setErro(null)
    setRenomeando(pipeline)
  }

  function abrirExcluir(pipeline: Pipeline) {
    setMenuAbertoId(null)
    setErro(null)
    setExcluindo(pipeline)
  }

  function fecharModais() {
    setRenomeando(null)
    setExcluindo(null)
    setErro(null)
  }

  async function salvarRenome(formData: FormData) {
    if (!renomeando) return
    const nome = String(formData.get('nome') ?? '')
    setSalvando(true)
    const r = await chamarAcao(renomear(renomeando.id, nome))
    setSalvando(false)
    if (!r.ok) {
      setErro(mensagemDePipeline(r.erro))
      return
    }
    fecharModais()
  }

  async function confirmarExclusao() {
    if (!excluindo) return
    const idExcluido = excluindo.id
    setExcluindoEmCurso(true)
    const r = await chamarAcao(excluir(idExcluido))
    setExcluindoEmCurso(false)
    if (!r.ok) {
      setErro(mensagemDePipeline(r.erro))
      return
    }
    fecharModais()
    if (idExcluido === pipelineAtivaId) router.push('/funil')
  }

  return (
    <div className="flex w-56 flex-col">
      <p className="eyebrow px-3 pb-1 pt-4">Pipelines</p>
      <nav aria-label="Pipelines" className="flex flex-col gap-0.5 p-2">
        {pipelines.map((p) => {
          const ativa = p.id === pipelineAtivaId
          return (
            <div
              key={p.id}
              className={`group flex items-center gap-0.5 rounded-xl pr-1 transition-colors ${
                ativa ? 'bg-accent' : 'hover:bg-accent/50'
              }`}
            >
              <Link
                href={hrefDoFunil(queryAtual, { pipeline: p.isDefault ? null : p.id })}
                aria-current={ativa ? 'page' : undefined}
                className={`flex-1 truncate rounded-xl px-3 py-2 text-[13px] ${
                  ativa ? 'font-semibold text-foreground' : 'text-muted-foreground'
                }`}
              >
                {p.nome}
              </Link>
              <div className="relative">
                <button
                  type="button"
                  aria-label={`Opções de ${p.nome}`}
                  onClick={() => setMenuAbertoId(menuAbertoId === p.id ? null : p.id)}
                  // opacity-0 + focus-visible:opacity-100: o kebab so aparece no
                  // hover da linha (menos ruido numa lista longa), mas continua
                  // alcancavel por Tab — sem a regra de foco ele seria um alvo
                  // invisivel para quem navega por teclado.
                  className="pressable rounded-lg p-1.5 text-muted-foreground opacity-0 hover:bg-secondary hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100"
                  aria-expanded={menuAbertoId === p.id}
                >
                  <EllipsisVertical size={15} strokeWidth={2} aria-hidden="true" />
                </button>
                {menuAbertoId === p.id && (
                  <div
                    aria-label={`Ações de ${p.nome}`}
                    className="surface fade-in absolute right-0 z-20 mt-1 flex w-36 flex-col gap-0.5 rounded-xl p-1 text-sm shadow-2xl"
                  >
                    <button
                      type="button"
                      onClick={() => abrirRenomear(p)}
                      className="pressable flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-accent"
                    >
                      <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
                      Renomear
                    </button>
                    <button
                      type="button"
                      onClick={() => abrirExcluir(p)}
                      className="pressable flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-destructive hover:bg-destructive/12"
                    >
                      <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
                      Excluir
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </nav>

      {renomeando && (
        <Modal titulo="Renomear pipeline" aoFechar={fecharModais}>
          <form action={salvarRenome} className="flex flex-col gap-3">
            <Rotulo>
              Nome da pipeline
              <Campo name="nome" defaultValue={renomeando.nome} />
            </Rotulo>

            {erro && <p className="text-sm text-destructive">{erro}</p>}

            <AcoesDoModal>
              <Botao type="button" variante="fantasma" onClick={fecharModais}>
                Cancelar
              </Botao>
              <Botao type="submit" disabled={salvando}>
                Salvar
              </Botao>
            </AcoesDoModal>
          </form>
        </Modal>
      )}

      {excluindo && (
        <Modal
          titulo={`Excluir ${excluindo.nome}?`}
          descricao="Essa ação não pode ser desfeita."
          aoFechar={fecharModais}
        >
          {erro && <p className="text-sm text-destructive">{erro}</p>}

          <AcoesDoModal>
            <Botao type="button" variante="fantasma" onClick={fecharModais}>
              Cancelar
            </Botao>
            <Botao
              type="button"
              variante="destrutivo"
              onClick={() => void confirmarExclusao()}
              disabled={excluindoEmCurso}
            >
              Confirmar exclusão
            </Botao>
          </AcoesDoModal>
        </Modal>
      )}
    </div>
  )
}
