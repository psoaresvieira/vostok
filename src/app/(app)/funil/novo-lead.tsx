'use client'

import { useState } from 'react'
import { Plus, TriangleAlert } from 'lucide-react'
import type { Membro } from '@/lib/domain/tipos'
import { chamarAcao, FALHA_DE_CONEXAO, MENSAGEM_FALHA_DE_CONEXAO } from '@/lib/ui/acao'
import { Botao } from '@/components/ui/botao'
import { Campo, Selecao } from '@/components/ui/campo'
import { Modal, AcoesDoModal } from '@/components/ui/modal'
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
      // tamanho="sm" (32px) para casar com a altura dos filtros ao lado: um
      // botao de 40px na mesma linha de controles de 32 desalinha a barra
      // inteira e ainda a deixa mais alta do que precisa.
      <Botao type="button" tamanho="sm" onClick={() => setAberto(true)} className="shrink-0">
        <Plus size={14} strokeWidth={2.25} aria-hidden="true" />
        Novo lead
      </Botao>
    )
  }

  return (
    <Modal titulo="Novo lead" largura="md" aoFechar={() => setAberto(false)}>
      <form action={salvar} className="flex flex-col gap-2.5">
        <input type="hidden" name="pipelineId" value={pipelineId} />
        <Campo name="nome" placeholder="nome" required />
        <Campo
          name="telefone"
          placeholder="telefone"
          onBlur={(e) =>
            checar(e.target.value, (e.currentTarget.form?.email as HTMLInputElement)?.value ?? '')
          }
        />
        <Campo
          name="email"
          placeholder="email"
          onBlur={(e) =>
            checar(
              (e.currentTarget.form?.telefone as HTMLInputElement)?.value ?? '',
              e.target.value,
            )
          }
        />
        <Campo name="empresa" placeholder="empresa" />
        <Campo name="valor" placeholder="valor em reais" />
        {podeEscolherResponsavel && (
          <Selecao name="responsavelId" defaultValue="">
            <option value="">sem responsável</option>
            {membros.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome}
              </option>
            ))}
          </Selecao>
        )}

        {duplicados.length > 0 && (
          <div className="flex gap-2.5 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
            <TriangleAlert
              size={16}
              strokeWidth={2}
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-warning"
            />
            <div>
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
          </div>
        )}

        {erro && <p className="text-sm text-destructive">{erro}</p>}

        <AcoesDoModal>
          <Botao type="button" variante="fantasma" onClick={() => setAberto(false)}>
            Cancelar
          </Botao>
          <Botao type="submit">Salvar</Botao>
        </AcoesDoModal>
      </form>
    </Modal>
  )
}
