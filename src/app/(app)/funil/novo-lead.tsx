'use client'

import { useState } from 'react'
import type { Membro } from '@/lib/domain/tipos'
import { chamarAcao, FALHA_DE_CONEXAO, MENSAGEM_FALHA_DE_CONEXAO } from '@/lib/ui/acao'
import { criarLeadAction, verificarDuplicados, type Duplicado } from './acoes'

const MENSAGENS: Record<string, string> = {
  nome_obrigatorio: 'Informe o nome do lead.',
  pipeline_sem_etapa_aberta: 'Configure ao menos uma etapa aberta antes de cadastrar leads.',
  valor_invalido: 'Digite o valor em reais, ex.: 1.500,00.',
  // Antes do Plano 4 so um dropdown de membros reais alimentava este campo, e
  // o codigo cru nunca chegava ate aqui. Agora ingerir_lead (0011) grava
  // responsavel_id sem humano no meio — um responsavel padrao que saiu da
  // conta depois de configurada a fonte pode reaparecer neste formulario
  // (o admin reabre um lead criado por webhook). Mesma mensagem que
  // funil/erros.ts e config/erros.ts ja usam para o mesmo codigo.
  responsavel_invalido:
    'Esse responsável não faz parte da sua conta. Recarregue a página e escolha de novo.',
  // Achado 1 do review final do Plano 14: criarLeadAction pode devolver isto
  // se a pipeline foi apagada por outra aba/usuario no meio do fluxo. Mesma
  // frase que MENSAGENS_PIPELINE usa em funil/erros.ts para o mesmo codigo.
  pipeline_nao_encontrado: 'Essa pipeline não existe mais. Recarregue a página.',
  [FALHA_DE_CONEXAO]: MENSAGEM_FALHA_DE_CONEXAO,
}

export function NovoLead({
  membros,
  podeEscolherResponsavel,
  pipelineId,
}: {
  membros: Membro[]
  podeEscolherResponsavel: boolean
  pipelineId: string
}) {
  const [aberto, setAberto] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [duplicados, setDuplicados] = useState<Duplicado[]>([])

  async function checar(telefone: string, email: string) {
    if (!telefone && !email) return
    const r = await chamarAcao(verificarDuplicados(telefone, email))
    setDuplicados(r.ok ? r.valor : [])
  }

  async function salvar(formData: FormData) {
    const r = await chamarAcao(criarLeadAction(formData))
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
        className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground"
      >
        Novo lead
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4">
      {/* .surface (mesmo utilitario do modal-movimento.tsx, ver comentario la)
          da o hairline e a sombra que faltavam ao painel sobre o scrim. */}
      <div className="surface w-full max-w-md rounded p-5">
        <h2 className="mb-3 text-lg font-semibold">Novo lead</h2>
        <form action={salvar} className="flex flex-col gap-2">
          <input type="hidden" name="pipelineId" value={pipelineId} />
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
            <div className="rounded border border-warning/40 bg-warning/10 p-2 text-sm">
              <p className="font-medium">Já existe lead com esse contato:</p>
              <ul className="mt-1 list-disc pl-4">
                {duplicados.map((d) => (
                  <li key={d.id}>
                    <a href={`/leads/${d.id}`} className="underline">
                      {d.nome}
                    </a>{' '}
                    <span className="text-muted-foreground">({d.status})</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-muted-foreground">
                Você pode continuar mesmo assim — recompra vira lead novo.
              </p>
            </div>
          )}

          {erro && <p className="text-sm text-destructive">{erro}</p>}

          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setAberto(false)} className="px-3 py-1 text-sm">
              Cancelar
            </button>
            <button type="submit" className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground">
              Salvar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
