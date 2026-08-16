'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Pipeline } from '@/lib/domain/tipos'
import type { Resultado } from '@/lib/domain/resultado'
import { chamarAcao } from '@/lib/ui/acao'
import { renomearPipelineAction, excluirPipelineAction } from './acoes-pipelines'
import { mensagemDePipeline } from './erros'

/**
 * Monta o href de um item da barra a partir de `queryAtual` (searchParams
 * atuais, ja serializados por quem monta a pagina) — nunca do zero. So a
 * chave `pipeline` muda: setada para o id nas nao-padrao, removida na
 * padrao (que vive em /funil sem query nenhuma). Preservar as demais chaves
 * (origem, busca, dias, responsavel...) e o motivo de partir de
 * `queryAtual` em vez de reconstruir a URL so com o id.
 */
function hrefDoItem(pipeline: Pipeline, queryAtual: string): string {
  const params = new URLSearchParams(queryAtual)
  if (pipeline.isDefault) params.delete('pipeline')
  else params.set('pipeline', pipeline.id)
  const query = params.toString()
  return query ? `/funil?${query}` : '/funil'
}

type AcaoRenomear = (pipelineId: string, nome: string) => Promise<Resultado<void>>
type AcaoExcluir = (pipelineId: string) => Promise<Resultado<void>>

/**
 * Coluna lateral do funil (Task 5): navegacao entre pipelines + kebab por
 * item com renomear/excluir. NAO conhece o modal de criacao («+ Nova
 * pipeline» e' da Task 6, montado pela pagina — Task 7 — logo abaixo desta
 * barra na mesma coluna).
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
    <div className="flex w-56 flex-col border-r border-border">
      <nav aria-label="Pipelines" className="flex flex-col gap-1 p-2">
        {pipelines.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-1">
            <Link
              href={hrefDoItem(p, queryAtual)}
              aria-current={p.id === pipelineAtivaId ? 'page' : undefined}
              className="flex-1 truncate rounded px-2 py-1 text-sm text-foreground aria-[current=page]:bg-muted aria-[current=page]:font-medium"
            >
              {p.nome}
            </Link>
            <div className="relative">
              <button
                type="button"
                aria-label={`Opções de ${p.nome}`}
                onClick={() => setMenuAbertoId(menuAbertoId === p.id ? null : p.id)}
                className="rounded px-1.5 py-1 text-sm text-muted-foreground hover:bg-muted"
              >
                ⋮
              </button>
              {menuAbertoId === p.id && (
                <div
                  aria-label={`Ações de ${p.nome}`}
                  className="surface absolute right-0 z-10 flex w-32 flex-col rounded p-1 text-sm"
                >
                  <button
                    type="button"
                    onClick={() => abrirRenomear(p)}
                    className="rounded px-2 py-1 text-left hover:bg-muted"
                  >
                    Renomear
                  </button>
                  <button
                    type="button"
                    onClick={() => abrirExcluir(p)}
                    className="rounded px-2 py-1 text-left hover:bg-muted"
                  >
                    Excluir
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </nav>

      {renomeando && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4">
          <div className="surface w-full max-w-sm rounded p-5">
            <h2 className="mb-3 text-lg font-semibold">Renomear pipeline</h2>
            <form action={salvarRenome} className="flex flex-col gap-2">
              <label className="text-sm">
                Nome da pipeline
                <input
                  name="nome"
                  defaultValue={renomeando.nome}
                  className="mt-1 w-full rounded border p-2"
                />
              </label>

              {erro && <p className="text-sm text-destructive">{erro}</p>}

              <div className="mt-2 flex justify-end gap-2">
                <button type="button" onClick={fecharModais} className="px-3 py-1 text-sm">
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvando}
                  className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
                >
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {excluindo && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4">
          <div className="surface w-full max-w-sm rounded p-5">
            <h2 className="mb-1 text-lg font-semibold">Excluir {excluindo.nome}?</h2>
            <p className="text-sm text-muted-foreground">Essa ação não pode ser desfeita.</p>

            {erro && <p className="mt-2 text-sm text-destructive">{erro}</p>}

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={fecharModais} className="px-3 py-1 text-sm">
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirmarExclusao()}
                disabled={excluindoEmCurso}
                className="rounded bg-destructive px-3 py-1 text-sm text-destructive-foreground disabled:opacity-50"
              >
                Confirmar exclusão
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
