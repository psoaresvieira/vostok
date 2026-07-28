'use client'

import { useState } from 'react'
import type { Membro } from '@/lib/domain/tipos'
import { criarLeadAction, verificarDuplicados, type Duplicado } from './acoes'

const MENSAGENS: Record<string, string> = {
  nome_obrigatorio: 'Informe o nome do lead.',
  pipeline_sem_etapa_aberta: 'Configure ao menos uma etapa aberta antes de cadastrar leads.',
  valor_invalido: 'Digite o valor em reais, ex.: 1.500,00.',
}

export function NovoLead({
  membros,
  podeEscolherResponsavel,
}: {
  membros: Membro[]
  podeEscolherResponsavel: boolean
}) {
  const [aberto, setAberto] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [duplicados, setDuplicados] = useState<Duplicado[]>([])

  async function checar(telefone: string, email: string) {
    if (!telefone && !email) return
    const r = await verificarDuplicados(telefone, email)
    setDuplicados(r.ok ? r.valor : [])
  }

  async function salvar(formData: FormData) {
    const r = await criarLeadAction(formData)
    if (!r.ok) {
      setErro(MENSAGENS[r.erro] ?? r.erro)
      return
    }
    setErro(null)
    setDuplicados([])
    setAberto(false)
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="rounded bg-black px-3 py-1 text-sm text-white"
      >
        Novo lead
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded bg-white p-5">
        <h2 className="mb-3 text-lg font-semibold">Novo lead</h2>
        <form action={salvar} className="flex flex-col gap-2">
          <input name="nome" placeholder="nome" required className="rounded border p-2" />
          <input
            name="telefone"
            placeholder="telefone"
            className="rounded border p-2"
            onBlur={(e) =>
              checar(e.target.value, (e.currentTarget.form?.email as HTMLInputElement)?.value ?? '')
            }
          />
          <input
            name="email"
            placeholder="email"
            className="rounded border p-2"
            onBlur={(e) =>
              checar(
                (e.currentTarget.form?.telefone as HTMLInputElement)?.value ?? '',
                e.target.value,
              )
            }
          />
          <input name="empresa" placeholder="empresa" className="rounded border p-2" />
          <input name="valor" placeholder="valor em reais" className="rounded border p-2" />
          {podeEscolherResponsavel && (
            <select name="responsavelId" defaultValue="" className="rounded border p-2">
              <option value="">sem responsável</option>
              {membros.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                </option>
              ))}
            </select>
          )}

          {duplicados.length > 0 && (
            <div className="rounded border border-amber-300 bg-amber-50 p-2 text-sm">
              <p className="font-medium">Já existe lead com esse contato:</p>
              <ul className="mt-1 list-disc pl-4">
                {duplicados.map((d) => (
                  <li key={d.id}>
                    <a href={`/leads/${d.id}`} className="underline">
                      {d.nome}
                    </a>{' '}
                    <span className="text-neutral-600">({d.status})</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-neutral-600">
                Você pode continuar mesmo assim — recompra vira lead novo.
              </p>
            </div>
          )}

          {erro && <p className="text-sm text-red-600">{erro}</p>}

          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setAberto(false)} className="px-3 py-1 text-sm">
              Cancelar
            </button>
            <button type="submit" className="rounded bg-black px-3 py-1 text-sm text-white">
              Salvar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
