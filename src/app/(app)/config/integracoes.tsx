'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { chamarAcao } from '@/lib/ui/acao'
import type { Resultado } from '@/lib/domain/resultado'
import type { Entrega, Fonte } from '@/lib/domain/fonte'
import type { Membro } from '@/lib/domain/tipos'
import { mensagemDeErro } from './erros'
import { Entregas } from './entregas'
import {
  listarPaginasDoMetaAction,
  conectarPaginaAction,
  reivindicarPaginaAction,
  conectarGoogleAction,
  definirResponsavelAction,
  desconectarFonteAction,
  type PaginaOferecida,
  type SegredoDoGoogle,
} from './acoes-fontes'

type Props = {
  fontes: Fonte[]
  membros: Membro[]
  origem: string
  /** 'escolher' quando o retorno do OAuth acabou de deixar o token no cookie. */
  etapa: string | null
  /** As ultimas entregas de webhook da conta — o painel de diagnostico. */
  entregas: Entrega[]
}

export function Integracoes({ fontes, membros, origem, etapa, entregas }: Props) {
  const router = useRouter()
  const [pendente, iniciar] = useTransition()

  // Derivado a cada render a partir da prop `etapa`, NUNCA copiado para dentro
  // de useState: essa e a regra do plano ("componente cliente nunca copia
  // prop do servidor para useState") e ela existe por um motivo concreto
  // aqui. Se `etapa` virasse o valor inicial de um useState, o componente
  // ficaria preso a mensagem de quando montou — numa navegacao soft que so
  // troca a query string (o router.replace mais abaixo, depois de conectar
  // uma Page, e exatamente isso), o componente nao remonta e o initializer do
  // useState nao roda de novo. `erroLocal` continua sendo estado de verdade
  // (erro de uma acao que o proprio usuario disparou agora), so a parte
  // derivada da URL nao pode morar em estado.
  const erroDeEtapa =
    etapa === 'estado_invalido'
      ? 'A conexão não pôde ser verificada. Comece de novo.'
      : etapa === 'recusado'
        ? 'Você não autorizou o acesso às páginas.'
        : etapa === 'indisponivel'
          ? mensagemDeErro('meta_indisponivel')
          : null
  const [erroLocal, setErroLocal] = useState<string | null>(null)
  const erro = erroLocal ?? erroDeEtapa

  const [paginas, setPaginas] = useState<PaginaOferecida[] | null>(null)
  const [nomeGoogle, setNomeGoogle] = useState('')
  const [segredoGoogle, setSegredoGoogle] = useState<SegredoDoGoogle | null>(null)
  /**
   * Page que voltou `page_ja_conectada` ao tentar conectar. Guarda id e nome
   * (nao so o id) para poder nomear a Page na confirmacao sem precisar
   * listar de novo. Reivindicar e destrutivo para um terceiro — a outra
   * conta do CRM perde a Page e para de receber os leads dela — entao isto
   * nunca dispara sozinho: precisa do clique explícito em "Reivindicar".
   */
  const [squat, setSquat] = useState<{ id: string; nome: string } | null>(null)

  function rodar(promessa: Promise<Resultado<void>>, aoDarCerto?: () => void) {
    iniciar(async () => {
      setErroLocal(null)
      const r = await chamarAcao(promessa)
      if (!r.ok) {
        setErroLocal(mensagemDeErro(r.erro))
        return
      }
      aoDarCerto?.()
      router.refresh()
    })
  }

  function conectarPagina(pageId: string) {
    iniciar(async () => {
      setErroLocal(null)
      setSquat(null)
      const r = await chamarAcao(conectarPaginaAction(pageId))
      if (!r.ok) {
        setErroLocal(mensagemDeErro(r.erro))
        // Oferece a reivindicacao so quando o motivo e page_ja_conectada:
        // e o unico erro cujo desfecho ("tomar a Page de outra conta") faz
        // sentido oferecer. Um erro qualquer com um botao de "tentar de
        // novo" disfarcado de reivindicacao seria enganoso.
        if (r.erro === 'page_ja_conectada') {
          const pagina = paginas?.find((p) => p.id === pageId)
          setSquat({ id: pageId, nome: pagina?.nome ?? pageId })
        }
        return
      }
      setPaginas(null)
      // router.replace, e nao router.refresh(): refresh mantem a URL como
      // esta, entao ?meta=escolher sobreviveria. Num reload seguinte o
      // componente remonta com `etapa` ainda 'escolher', o efeito abaixo
      // chama listarPaginasDoMetaAction de novo, o COOKIE_TOKEN ja foi apagado
      // no sucesso desta acao (linha abaixo, no servidor), e a tela pintaria
      // "a conexao com o Meta expirou" por cima de uma fonte que conectou
      // perfeitamente — o achado do review que motivou esta troca.
      router.replace('/config')
    })
  }

  function reivindicarPagina() {
    if (!squat) return
    const pageId = squat.id
    iniciar(async () => {
      setErroLocal(null)
      const r = await chamarAcao(reivindicarPaginaAction(pageId))
      if (!r.ok) {
        setErroLocal(mensagemDeErro(r.erro))
        return
      }
      setSquat(null)
      setPaginas(null)
      router.replace('/config')
    })
  }

  async function carregarPaginas() {
    setErroLocal(null)
    const r = await chamarAcao(listarPaginasDoMetaAction())
    if (!r.ok) {
      setErroLocal(mensagemDeErro(r.erro))
      return
    }
    setPaginas(r.valor)
  }

  // useEffect, e nao chamada solta no corpo do componente: disparar uma Server
  // Action durante o render e efeito colateral em render, e o React 19 renderiza
  // duas vezes em desenvolvimento — a acao sairia duplicada.
  //
  // A guarda `carregou` e do mesmo naipe: em Strict Mode o efeito tambem roda
  // duas vezes, e sem ela a segunda execucao repetiria a chamada ao Graph API.
  const carregou = useRef(false)
  useEffect(() => {
    if (etapa !== 'escolher' || carregou.current) return
    carregou.current = true
    void carregarPaginas()
    // carregarPaginas so le setters de estado, que sao estaveis; depender de
    // `etapa` e o suficiente.
  }, [etapa])

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">Integrações</h2>

      {erro && <p className="text-sm text-red-600">{erro}</p>}

      {squat && (
        <div className="flex flex-col gap-2 rounded border border-red-400 bg-red-50 p-3">
          <p className="text-sm font-medium">
            &ldquo;{squat.nome}&rdquo; já está conectada a outra conta do CRM.
          </p>
          <p className="text-xs text-gray-700">
            Você confirmou no Facebook que administra essa página agora. Se
            continuar, ela sai da outra conta do CRM e passa a entregar leads
            para esta conta — a outra conta deixa de vê-la e de recebê-los.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pendente}
              className="rounded bg-red-600 px-3 py-2 text-sm text-white disabled:opacity-50"
              onClick={reivindicarPagina}
            >
              Reivindicar esta página
            </button>
            <button
              type="button"
              disabled={pendente}
              className="rounded border px-3 py-2 text-sm disabled:opacity-50"
              onClick={() => setSquat(null)}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {paginas && (
        <div className="flex flex-col gap-2 rounded border p-3">
          <p className="text-sm font-medium">Escolha a página que traz os leads</p>
          {paginas.length === 0 && (
            <p className="text-sm text-gray-600">
              Nenhuma página encontrada nesta conta do Facebook.
            </p>
          )}
          {paginas.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={pendente}
              className="rounded border px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50"
              onClick={() => conectarPagina(p.id)}
            >
              {p.nome}
            </button>
          ))}
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {fontes.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center gap-2 rounded border p-3">
            <span className="text-sm font-medium">{f.nome}</span>
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs uppercase">
              {f.provedor}
            </span>
            <label className="ml-auto flex items-center gap-2 text-sm">
              Responsável
              <select
                className="rounded border px-2 py-1"
                value={f.responsavelPadraoId ?? ''}
                disabled={pendente}
                onChange={(e) =>
                  rodar(definirResponsavelAction(f.id, e.target.value || null))
                }
              >
                <option value="">Sem responsável</option>
                {membros.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={pendente}
              className="rounded border px-2 py-1 text-sm disabled:opacity-50"
              onClick={() => rodar(desconectarFonteAction(f.id))}
            >
              Desconectar
            </button>
          </li>
        ))}
        {fontes.length === 0 && (
          <li className="text-sm text-gray-600">Nenhuma fonte conectada ainda.</li>
        )}
      </ul>

      <div className="flex flex-wrap items-end gap-2">
        <a
          href="/api/integracoes/meta/iniciar"
          className="rounded bg-blue-600 px-3 py-2 text-sm text-white"
        >
          Conectar Facebook
        </a>

        <label className="flex flex-col text-sm">
          Nome do formulário do Google
          <input
            className="rounded border px-2 py-1"
            placeholder="nome do formulário"
            value={nomeGoogle}
            onChange={(e) => setNomeGoogle(e.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={pendente}
          className="rounded border px-3 py-2 text-sm disabled:opacity-50"
          onClick={() =>
            iniciar(async () => {
              setErroLocal(null)
              const r = await chamarAcao(conectarGoogleAction(nomeGoogle, origem))
              if (!r.ok) {
                setErroLocal(mensagemDeErro(r.erro))
                return
              }
              setSegredoGoogle(r.valor)
              setNomeGoogle('')
              router.refresh()
            })
          }
        >
          Gerar URL do Google
        </button>
      </div>

      {segredoGoogle && (
        <div className="flex flex-col gap-1 rounded border border-amber-400 bg-amber-50 p-3">
          <p className="text-sm font-medium">
            Copie agora — não mostramos de novo.
          </p>
          <code className="break-all text-xs">{segredoGoogle.url}</code>
          <code className="break-all text-xs">chave: {segredoGoogle.chave}</code>
          <p className="text-xs text-gray-700">
            No Google Ads, cole os dois em Ativo de formulário de lead → Integração via
            webhook.
          </p>
          <p className="text-xs text-gray-700">
            Fechou sem copiar? Não há como reabrir esta caixa: desconecte esta
            integração e conecte de novo para gerar uma URL e uma chave novas.
          </p>
        </div>
      )}

      <Entregas entregas={entregas} />
    </section>
  )
}
