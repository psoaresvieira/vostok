import Link from 'next/link'
import { redirect } from 'next/navigation'
import { criarScriptStoreDoServidor } from '@/lib/data/scripts'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import { mensagemDeErroScript } from './erros'
import { ListaDeScripts } from './lista'

/**
 * Uma chave repetida na URL (`?busca=a&busca=b`) chega como string[], nao como
 * string — o tipo `Record<string, string | undefined>` que o resto do repo usa
 * mente sobre isso. Um array descendo ate `padraoIlike` estoura dentro de um
 * server component que esta tela inteira foi escrita para nunca deixar
 * estourar. Nao ha leitura util de "buscar duas coisas ao mesmo tempo": o
 * segundo valor e' descartado junto com o primeiro e o filtro fica vazio.
 */
function paramDeTexto(v: string | string[] | undefined): string {
  return typeof v === 'string' ? v : ''
}

export default async function ScriptsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams

  // Os dois contextos sao independentes (cada um resolve o proprio cliente e a
  // conta ativa): em serie somariam dois round-trips a toda carga desta tela.
  const [contexto, base] = await Promise.all([
    criarScriptStoreDoServidor(),
    criarStoreDoServidor(),
  ])
  if (!contexto.ok) redirect('/login')
  if (!base.ok) redirect('/login')
  const { scripts, papel } = contexto.valor

  // Degrada para lista vazia em vez de derrubar a pagina, mesma decisao do
  // `listar` mais abaixo: as etapas so alimentam o <select> de filtro e o nome
  // da etapa nos cards. Quem so ia olhar a biblioteca nao pode perder a tela
  // porque a consulta do funil falhou.
  const pipeline = await base.valor.store.pipelinePadrao()
  const etapas = pipeline.ok ? pipeline.valor.etapas : []
  const nomeDaEtapa = new Map(etapas.map((e) => [e.id, e.nome]))

  // '' = sem filtro nos tres, e e' o valor que o proprio <form method="get">
  // devolve quando o campo fica em branco — nao ha estado ambiguo entre
  // "ausente" e "vazio" como no `responsavel` de /tarefas.
  const busca = paramDeTexto(params.busca)
  const tag = paramDeTexto(params.tag)
  const etapa = paramDeTexto(params.etapa)

  const [lista, tagsDaConta] = await Promise.all([
    scripts.listar({ busca: busca || null, tag: tag || null, stageId: etapa || null }),
    scripts.tagsDaConta(),
  ])
  // Mesma tolerancia: sem as tags o <select> fica so com "Qualquer tag".
  const tags = tagsDaConta.ok ? tagsDaConta.valor : []

  const podeEscrever = papel !== 'vendedor'

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Scripts</h1>
        {/* Esconder o botao NAO e a guarda: quem barra a escrita do vendedor e
            a RLS da 0020 mais o pre-check das actions. Isto e so nao oferecer
            um caminho que terminaria em recusa. */}
        {podeEscrever && (
          <Link href="/scripts/novo" className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground">
            Novo script
          </Link>
        )}
      </div>

      <form method="get" action="/scripts" className="flex flex-wrap items-end gap-2">
        {/* htmlFor/id em todos os campos, sem <label> em volta do controle —
            ver o comentario longo em editor.tsx: envolvido, o nome acessivel de
            um <select> herda o texto de todas as <option>. */}
        <div className="flex flex-col text-sm">
          <label htmlFor="filtro-busca">Buscar</label>
          <input
            id="filtro-busca"
            name="busca"
            defaultValue={busca}
            placeholder="título ou conteúdo"
            className="rounded border border-border px-2 py-1"
          />
        </div>
        <div className="flex flex-col text-sm">
          <label htmlFor="filtro-tag">Tag</label>
          <select
            id="filtro-tag"
            name="tag"
            defaultValue={tag}
            className="rounded border border-border px-2 py-1"
          >
            <option value="">Qualquer tag</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col text-sm">
          <label htmlFor="filtro-etapa">Etapa</label>
          <select
            id="filtro-etapa"
            name="etapa"
            defaultValue={etapa}
            className="rounded border border-border px-2 py-1"
          >
            <option value="">Qualquer etapa</option>
            {etapas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded border border-border px-3 py-1 text-sm">
          Filtrar
        </button>
      </form>

      {/* Falha de leitura vira mensagem do mapa, nunca throw: a biblioteca
          indisponivel nao pode derrubar a navegacao de quem so ia olhar. */}
      {!lista.ok ? (
        <p className="text-destructive">{mensagemDeErroScript(lista.erro)}</p>
      ) : lista.valor.length === 0 ? (
        <div className="flex flex-col gap-2 rounded border border-border p-6 text-sm">
          <p className="text-muted-foreground">
            {busca || tag || etapa
              ? 'Nenhum script com esses filtros.'
              : 'Nenhum script na biblioteca ainda.'}
          </p>
          {podeEscrever && !busca && !tag && !etapa && (
            <Link href="/scripts/novo" className="w-fit underline">
              Escrever o primeiro script
            </Link>
          )}
        </div>
      ) : (
        // podeEscrever governa as duas coisas de proposito: quem nao edita nao
        // ve "Novo script" nem titulo linkado, porque /scripts/[id] responde
        // notFound() para ele. Ver o comentario em lista.tsx.
        <ListaDeScripts
          scripts={lista.valor}
          nomeDaEtapa={nomeDaEtapa}
          podeEditar={podeEscrever}
        />
      )}
    </div>
  )
}
