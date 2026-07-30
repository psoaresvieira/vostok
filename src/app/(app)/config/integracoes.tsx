'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { chamarAcao } from '@/lib/ui/acao'
import type { Resultado } from '@/lib/domain/resultado'
import type { Fonte } from '@/lib/domain/fonte'
import type { Membro } from '@/lib/domain/tipos'
import { mensagemDeErro } from './erros'
import {
  listarPaginasDoMetaAction,
  conectarPaginaAction,
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
}

export function Integracoes({ fontes, membros, origem, etapa }: Props) {
  const router = useRouter()
  const [pendente, iniciar] = useTransition()
  const [erro, setErro] = useState<string | null>(
    etapa === 'estado_invalido'
      ? 'A conexão não pôde ser verificada. Comece de novo.'
      : etapa === 'recusado'
        ? 'Você não autorizou o acesso às páginas.'
        : etapa === 'indisponivel'
          ? mensagemDeErro('meta_indisponivel')
          : null,
  )
  const [paginas, setPaginas] = useState<PaginaOferecida[] | null>(null)
  const [nomeGoogle, setNomeGoogle] = useState('')
  const [segredoGoogle, setSegredoGoogle] = useState<SegredoDoGoogle | null>(null)

  function rodar(promessa: Promise<Resultado<void>>, aoDarCerto?: () => void) {
    iniciar(async () => {
      setErro(null)
      const r = await chamarAcao(promessa)
      if (!r.ok) {
        setErro(mensagemDeErro(r.erro))
        return
      }
      aoDarCerto?.()
      router.refresh()
    })
  }

  async function carregarPaginas() {
    setErro(null)
    const r = await chamarAcao(listarPaginasDoMetaAction())
    if (!r.ok) {
      setErro(mensagemDeErro(r.erro))
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
              onClick={() =>
                rodar(conectarPaginaAction(p.id), () => setPaginas(null))
              }
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
              setErro(null)
              const r = await chamarAcao(conectarGoogleAction(nomeGoogle, origem))
              if (!r.ok) {
                setErro(mensagemDeErro(r.erro))
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
        </div>
      )}
    </section>
  )
}
