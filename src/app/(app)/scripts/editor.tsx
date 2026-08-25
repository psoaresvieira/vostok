'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { DadosScript, Script } from '@/lib/data/scripts'
import type { Etapa } from '@/lib/domain/tipos'
import type { Resultado } from '@/lib/domain/resultado'
import {
  VARIAVEIS,
  contarPendencias,
  interpolar,
  normalizarTags,
  type ContextoScript,
} from '@/lib/domain/script'
import { chamarAcao } from '@/lib/ui/acao'
import { mensagemDeErroScript } from './erros'
import { criarScript, atualizarScript, excluirScript } from './acoes'
import { PreviaSegmentos } from './previa'

/**
 * Lead ficticio do preview. `empresa` e' NULO DE PROPOSITO: a lacuna tem que
 * ser visivel enquanto se escreve, nao so na hora de enviar para um lead real.
 * Um exemplo com todos os campos preenchidos deixaria o autor do script achar
 * que `{{empresa}}` sempre resolve.
 */
const LEAD_EXEMPLO: ContextoScript = {
  nome_lead: 'Maria da Silva',
  primeiro_nome: 'Maria',
  empresa: null,
  email: 'maria@exemplo.com.br',
  telefone: '(11) 91234-5678',
  responsavel: 'Você',
  etapa: 'Qualificação',
}

type AcaoCriar = (d: DadosScript) => Promise<Resultado<string>>
type AcaoAtualizar = (id: string, d: DadosScript) => Promise<Resultado<void>>
type AcaoExcluir = (id: string) => Promise<Resultado<void>>

function plural(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`
}

/**
 * Editor de script, usado pelas duas rotas: `/scripts/novo` (script = null) e
 * `/scripts/[id]`. Actions por prop com default, mesmo padrao de whatsapp.tsx e
 * etapas.tsx — e' o que torna o preview e o salvar testaveis sem servidor.
 */
export function Editor({
  script,
  etapas,
  criar = criarScript,
  atualizar = atualizarScript,
  excluir = excluirScript,
}: {
  script: Script | null
  etapas: Etapa[]
  criar?: AcaoCriar
  atualizar?: AcaoAtualizar
  excluir?: AcaoExcluir
}) {
  const router = useRouter()
  const [titulo, setTitulo] = useState(script?.titulo ?? '')
  const [conteudo, setConteudo] = useState(script?.conteudo ?? '')
  // '' e' o "Qualquer etapa" do <select>; vira null no DadosScript.
  const [stageId, setStageId] = useState(script?.stageId ?? '')
  const [tagsTexto, setTagsTexto] = useState((script?.tags ?? []).join(', '))
  const [pendente, setPendente] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  // Posicao onde o cursor deve ficar depois de inserir uma variavel. Nao da
  // pra chamar setSelectionRange no mesmo tick do setConteudo: o valor do
  // textarea so muda no render seguinte, e o caret voltaria para o fim.
  const [caret, setCaret] = useState<number | null>(null)
  const refConteudo = useRef<HTMLTextAreaElement>(null)
  // Um <textarea> que nunca foi tocado reporta selectionStart 0, e 0 nao e'
  // distinguivel de "o usuario pos o cursor no comeco". Sem esta marca, clicar
  // numa variavel ao abrir um script existente enfiava {{nome}} ANTES da
  // primeira letra do texto ja escrito. Vira true no foco E no onChange —
  // digitar sem foco nao existe, e no jsdom um fireEvent.change chega sem
  // evento de foco nenhum. Ref e nao state: so e' lida dentro do handler, e um
  // re-render por foco nao serve a ninguem.
  const cursorConfiavel = useRef(false)

  useEffect(() => {
    if (caret === null) return
    const el = refConteudo.current
    if (el) {
      el.focus()
      el.setSelectionRange(caret, caret)
    }
    setCaret(null)
  }, [caret])

  // Uma passada por tecla: interpolar e' puro e o conteudo de um script cabe
  // em memoria com folga. Preview e envio (Task 5) passam pela MESMA funcao,
  // entao nao existe segundo caminho de render que possa divergir.
  const segmentos = interpolar(conteudo, LEAD_EXEMPLO)
  const pendencias = contarPendencias(segmentos)
  // As tags que a tela mostra sao as que ela envia: exibir o cru e gravar o
  // normalizado (ou o contrario) faria o usuario discordar do que salvou.
  const tags = normalizarTags(tagsTexto.split(','))

  // Enquanto o campo nunca foi focado, o fim do texto e' o unico palpite
  // honesto: o usuario nao escolheu posicao nenhuma. Depois do primeiro foco
  // (inclusive o que o efeito acima devolve), vale o cursor de verdade. Um so
  // criterio para "onde fica o cursor", usado tanto por inserirVariavel quanto
  // por inserirFormatacao — duplica-lo teria criado um segundo caminho de
  // insercao que podia divergir do primeiro.
  function selecaoAtual(): { inicio: number; fim: number } {
    const el = refConteudo.current
    const temCursor = cursorConfiavel.current && el !== null
    return temCursor
      ? { inicio: el.selectionStart, fim: el.selectionEnd }
      : { inicio: conteudo.length, fim: conteudo.length }
  }

  function inserirVariavel(nome: string) {
    const tag = `{{${nome}}}`
    const { inicio, fim } = selecaoAtual()
    setConteudo(conteudo.slice(0, inicio) + tag + conteudo.slice(fim))
    setCaret(inicio + tag.length)
  }

  // Com selecao, o delimitador envolve exatamente o texto selecionado; sem
  // selecao, insere o par vazio e poe o cursor entre os dois delimitadores
  // (nao no fim), para o autor digitar na hora sem precisar mover a mao pro
  // meio.
  function inserirFormatacao(delimitador: string) {
    const { inicio, fim } = selecaoAtual()
    const selecionado = conteudo.slice(inicio, fim)
    const novo =
      conteudo.slice(0, inicio) + delimitador + selecionado + delimitador + conteudo.slice(fim)
    setConteudo(novo)
    setCaret(inicio === fim ? inicio + delimitador.length : fim + 2 * delimitador.length)
  }

  async function salvar() {
    if (pendente) return
    setPendente(true)
    setErro(null)
    setAviso(null)

    const dados: DadosScript = { titulo, conteudo, stageId: stageId || null, tags }

    // Os dois ramos separados, e nao um ternario: `criar` devolve o id e
    // `atualizar` nao, entao o Resultado<T> tem T diferente em cada um.
    if (script) {
      const r = await chamarAcao(atualizar(script.id, dados))
      setPendente(false)
      if (!r.ok) {
        setErro(mensagemDeErroScript(r.erro))
        return
      }
      setAviso('Script salvo.')
      router.refresh()
      return
    }

    const r = await chamarAcao(criar(dados))
    setPendente(false)
    if (!r.ok) {
      setErro(mensagemDeErroScript(r.erro))
      return
    }
    // O id so existe depois da escrita: e' o retorno da action que diz para
    // onde ir. Sem isto o autor ficaria numa tela /scripts/novo que ja gravou,
    // e um segundo "Salvar" criaria um script duplicado.
    router.push(`/scripts/${r.valor}`)
  }

  async function confirmarExclusao() {
    if (!script || excluindo) return
    setExcluindo(true)
    const r = await chamarAcao(excluir(script.id))
    setExcluindo(false)
    setConfirmando(false)
    if (!r.ok) {
      setErro(mensagemDeErroScript(r.erro))
      return
    }
    // A biblioteca vive em /disparo desde a Task 7 (Plano 13); /scripts so
    // redireciona para la, entao mandar para ele so para bater no redirect
    // no proximo request seria um passo a mais sem motivo.
    router.push('/disparo')
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-3">
        {/* Todos os campos com htmlFor/id, e nenhum <label> envolvendo o
            controle. Nao e estilo: <label> em volta de um <select> ou de um
            <textarea> faz o nome acessivel do campo virar o textContent do
            label INTEIRO — que inclui o texto de todas as <option> e, no
            textarea, o proprio conteudo digitado (React mantem defaultValue em
            sincronia, e para textarea defaultValue E o textContent). No
            navegador o campo Conteúdo se chamava "Conteúdo Oi Maria, aqui e
            sobre a...". Os dois achados sao da verificacao no navegador desta
            task; o jsdom nao os pega porque o @testing-library calcula o rotulo
            de outro jeito. Os <input> nao teriam o problema, mas duas
            convencoes no mesmo formulario e o que faz a proxima pessoa
            reintroduzir a errada. */}
        <div className="flex flex-col text-sm">
          <label htmlFor="script-titulo">Título</label>
          <input
            id="script-titulo"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            className="rounded-lg border border-border bg-muted/40 px-2.5 py-1.5"
          />
        </div>

        <div className="flex flex-col text-sm">
          <label htmlFor="script-etapa">Etapa</label>
          <select
            id="script-etapa"
            value={stageId}
            onChange={(e) => setStageId(e.target.value)}
            className="rounded-lg border border-border bg-muted/40 px-2.5 py-1.5"
          >
            <option value="">Qualquer etapa</option>
            {etapas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col text-sm">
          <label htmlFor="script-tags">Tags</label>
          <input
            id="script-tags"
            value={tagsTexto}
            onChange={(e) => setTagsTexto(e.target.value)}
            placeholder="objeção, preço"
            className="rounded-lg border border-border bg-muted/40 px-2.5 py-1.5"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Separe por vírgula. Máximo de 10; ficam em minúsculas, sem repetir.
        </p>
        {tags.length > 0 && (
          <ul className="flex flex-wrap gap-1">
            {tags.map((t) => (
              <li key={t} className="rounded bg-muted px-2 py-0.5 text-xs">
                {t}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col text-sm">
          <label htmlFor="script-conteudo">Conteúdo</label>
          <textarea
            id="script-conteudo"
            ref={refConteudo}
            value={conteudo}
            onFocus={() => {
              cursorConfiavel.current = true
            }}
            onChange={(e) => {
              cursorConfiavel.current = true
              setConteudo(e.target.value)
            }}
            rows={16}
            // `resize-y`, e nao o `resize-none` que a nota do lead usa: aqui se
            // escreve o script inteiro, e poder esticar a area de escrita e'
            // util. O que fica proibido e' o eixo HORIZONTAL — e' ele que
            // atravessa o card e empurra a coluna vizinha; a altura so' empurra
            // o que esta abaixo, e volta ao normal ao rolar.
            className="resize-y rounded-xl border border-border bg-muted/60 px-3 py-2 font-mono text-sm leading-relaxed focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
          />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Formatação:</span>
          <ul className="flex flex-wrap gap-1">
            {(
              [
                { nome: 'Negrito', delimitador: '*', className: 'font-bold' },
                { nome: 'Itálico', delimitador: '_', className: 'italic' },
                { nome: 'Riscado', delimitador: '~', className: 'line-through' },
              ] as const
            ).map((f) => (
              <li key={f.nome}>
                <button
                  type="button"
                  onClick={() => inserirFormatacao(f.delimitador)}
                  className={`rounded border border-border px-2 py-0.5 text-xs ${f.className}`}
                >
                  {f.nome}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">
            Clique para inserir onde está o cursor:
          </span>
          <ul className="flex flex-wrap gap-1">
            {VARIAVEIS.map((v) => (
              <li key={v}>
                <button
                  type="button"
                  aria-label={`Inserir ${v}`}
                  onClick={() => inserirVariavel(v)}
                  className="rounded border border-border px-2 py-0.5 font-mono text-xs"
                >
                  {`{{${v}}}`}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void salvar()}
            disabled={pendente}
            className="pressable inline-flex shrink-0 items-center justify-center gap-2 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 h-10 rounded-xl bg-primary px-4 text-sm text-primary-foreground shadow-sm hover:brightness-110"
          >
            {pendente ? 'Salvando…' : 'Salvar'}
          </button>

          {script &&
            (!confirmando ? (
              <button
                type="button"
                onClick={() => {
                  // Mesma disciplina de whatsapp.tsx: um erro de uma tentativa
                  // anterior nao pode sobreviver a abertura de um dialogo novo,
                  // como se fizesse parte dele.
                  setErro(null)
                  setAviso(null)
                  setConfirmando(true)
                }}
                className="rounded border border-border px-3 py-2 text-sm"
              >
                Excluir
              </button>
            ) : (
              <div
                role="dialog"
                aria-label="Excluir script"
                className="flex items-center gap-2 rounded border border-border p-2 text-sm"
              >
                <span>Excluir este script?</span>
                <button
                  type="button"
                  onClick={() => void confirmarExclusao()}
                  disabled={excluindo}
                  aria-label="Confirmar exclusão"
                  className="rounded bg-destructive px-3 py-1 text-destructive-foreground disabled:opacity-50"
                >
                  Confirmar exclusão
                </button>
                {/* autoFocus no Cancelar: mesmo motivo de
                    template-whatsapp.tsx — foco entra no dialogo, na acao
                    menos destrutiva. */}
                <button
                  type="button"
                  autoFocus
                  aria-label="Cancelar exclusão"
                  onClick={() => setConfirmando(false)}
                >
                  Cancelar
                </button>
              </div>
            ))}
        </div>

        {erro && <p className="text-sm text-destructive">{erro}</p>}
        {aviso && <p className="text-sm text-success">{aviso}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Prévia com um lead de exemplo</h2>
        <p className="text-xs text-muted-foreground">
          Maria da Silva, sem empresa cadastrada — para as lacunas aparecerem enquanto você escreve.
        </p>

        <div
          role="region"
          aria-label="Prévia"
          className="min-h-40 whitespace-pre-wrap rounded border border-border p-3 text-sm"
        >
          {/* A tag literal de lacuna/desconhecida continua no texto, nunca
              substituida por vazio, e o rotulo de a11y vai num <span>
              escondido DENTRO da marca — nao num aria-label nela, ja que o
              papel ARIA de <mark> e' name-prohibited. Pintura compartilhada
              com o painter da ficha do lead (Plano 13, Task 2). */}
          <PreviaSegmentos segmentos={segmentos} />
        </div>

        {segmentos.length === 0 && (
          <p className="text-xs text-muted-foreground">A prévia aparece conforme você escreve.</p>
        )}
        {pendencias.lacunas > 0 && (
          <p className="text-sm text-warning">
            {plural(pendencias.lacunas, 'variável sem valor', 'variáveis sem valor')}
          </p>
        )}
        {pendencias.desconhecidas > 0 && (
          <p className="text-sm text-destructive">
            {plural(
              pendencias.desconhecidas,
              'variável desconhecida',
              'variáveis desconhecidas',
            )}{' '}
            — confira o nome.
          </p>
        )}
      </div>
    </div>
  )
}
