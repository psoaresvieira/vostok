import { Suspense } from 'react'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { classesDeBotao } from '@/components/ui/botao'
import { Selo } from '@/components/ui/selo'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import { criarTarefaStoreDoServidor, type Tarefa } from '@/lib/data/tarefas'
import { falha } from '@/lib/domain/resultado'
import { formatarMoeda, formatarTelefone } from '@/lib/domain/formato'
import { contextoDoLead } from '@/lib/domain/script'
import { Timeline } from '@/app/(app)/funil/drawer/timeline'
import { EditorEtiquetas } from '@/app/(app)/funil/drawer/etiquetas'
import { FormularioNota } from '@/app/(app)/funil/drawer/nota'
import { AcoesLead } from '@/app/(app)/funil/drawer/acoes-lead'
import { PainelTarefas } from '@/app/(app)/funil/drawer/tarefas'
import { BlocoScripts } from '@/app/(app)/funil/drawer/bloco-scripts'

/**
 * Quantos eventos a linha do tempo carrega.
 *
 * A consulta nao tinha teto: um lead antigo (dezenas de movimentos, notas,
 * etiquetas e envios) serializava a historia INTEIRA no payload da ficha, e
 * cada linha de `lead_events` passa pela policy `lead_events_select`, que roda
 * `pode_ver_lead_id` por linha. 60 e' mais do que a janela que alguem le de
 * uma vez; o aviso abaixo da lista conta quando ha mais.
 */
const LIMITE_EVENTOS = 60

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const contexto = await criarStoreDoServidor()
  if (!contexto.ok) redirect('/login')
  const { store, papel } = contexto.valor

  // TUDO que nao depende da linha do lead sai junto com ela, e nao depois:
  // membros, etiquetas, motivos, tarefas e timeline so' precisam do `id` da
  // URL. Antes a ficha esperava `buscarLead` terminar para so' entao comecar
  // as outras — duas latencias em serie no caminho critico da tela que o
  // usuario reclamou de lenta.
  //
  // A unica que fica de fora e' `pipelinePorId`, que precisa do `pipelineId`
  // da linha lida. Se o lead nao existir (ou a RLS o esconder), as cinco
  // leituras ao lado terao sido feitas a toa — uma ficha 404 e' rara o
  // bastante para valer o corte de latencia em todas as outras.
  //
  // `tarefaStore.doLead` vinha numa SEGUNDA rodada, encadeada depois da
  // construcao do store; agora a construcao e a consulta moram na mesma
  // funcao interna e a latencia das duas nao se soma a das demais.
  //
  // `LIMITE_EVENTOS + 1` de proposito: a linha extra e' so' o sinal de que ha
  // historia mais antiga (a lista desenha `LIMITE_EVENTOS`), e sai mais barato
  // que um count exato numa tabela cuja policy roda por linha.
  const [lead, membros, eventos, etiquetas, motivos, tarefas, pipelines] = await Promise.all([
    store.buscarLead(id),
    store.membros(),
    store.eventosDoLead(id, LIMITE_EVENTOS + 1),
    store.etiquetasDaConta(),
    store.motivosPerda(),
    (async () => {
      const tarefaStore = await criarTarefaStoreDoServidor()
      // Encaminha o codigo do store em vez de lancar aqui dentro: uma excecao
      // dentro do Promise.all rejeitaria a rodada inteira e perderia os erros
      // das outras cinco leituras. O `throw` continua logo abaixo, igual.
      if (!tarefaStore.ok) return falha<Tarefa[]>(tarefaStore.erro)
      return tarefaStore.valor.doLead(id)
    })(),
    // So' para nomear as pipelines nos eventos `pipeline_alterada` da linha
    // do tempo. Entra no mesmo Promise.all das outras: nao depende da linha
    // do lead, entao nao tem por que somar latencia.
    store.listarPipelines(),
  ])
  if (!lead.ok) throw new Error(lead.erro)
  // Zero linhas por RLS chega aqui como null: e "nao encontrado", nunca 403.
  if (!lead.valor) notFound()
  if (!membros.ok) throw new Error(membros.erro)
  if (!eventos.ok) throw new Error(eventos.erro)
  if (!etiquetas.ok) throw new Error(etiquetas.erro)
  if (!motivos.ok) throw new Error(motivos.erro)
  if (!tarefas.ok) throw new Error(tarefas.erro)
  if (!pipelines.ok) throw new Error(pipelines.erro)

  const pipeline = await store.pipelinePorId(lead.valor.pipelineId)
  if (!pipeline.ok) throw new Error(pipeline.erro)

  const temMaisEventos = eventos.valor.length > LIMITE_EVENTOS
  const eventosVisiveis = temMaisEventos ? eventos.valor.slice(0, LIMITE_EVENTOS) : eventos.valor

  const nomeEtapa = new Map(pipeline.valor.etapas.map((e) => [e.id, e.nome]))
  const nomePessoa = new Map(membros.valor.map((m) => [m.id, m.nome]))
  const nomePipeline = new Map(pipelines.valor.map((p) => [p.id, p.nome]))
  // Um contexto so para a ficha inteira: os mapas acima ja existem para a
  // timeline, e `contextoDoLead` e' puro — nada aqui vai ao banco de novo.
  const contextoScript = contextoDoLead(lead.valor, nomeEtapa, nomePessoa)

  return (
    <div className="fade-in mx-auto flex max-w-6xl flex-col gap-6 p-6 sm:p-8">
      {/* Cabecalho da ficha, largura inteira. O "← voltar ao funil" era um
          link sublinhado solto no canto; virou botao de contorno com seta.
          Continua sendo <a> (Link, nao <button>): abrir a pipeline em nova
          aba tem que funcionar, e page.test.tsx seleciona por
          `getByRole('link', { name: /voltar ao funil/i })`. Link do Next com
          classesDeBotao, NAO BotaoLink: o <a> cru fazia navegacao de pagina
          inteira, e o funil recem-carregado engolia o primeiro clique de quem
          voltava (janela de hidratacao — pipelines.spec.ts pegou isso). */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col items-start gap-3">
          <Link
            href={
              pipeline.valor.pipeline.isDefault
                ? '/funil'
                : `/funil?pipeline=${pipeline.valor.pipeline.id}`
            }
            className={classesDeBotao('contorno', 'sm')}
          >
            <ArrowLeft size={15} strokeWidth={2} aria-hidden="true" />
            Voltar ao funil
          </Link>
          <div>
            <h1 className="text-[26px] font-semibold">{lead.valor.nome}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Selo tom="primario">{nomeEtapa.get(lead.valor.stageId) ?? '—'}</Selo>
              {lead.valor.empresa && (
                <span className="text-sm text-muted-foreground">{lead.valor.empresa}</span>
              )}
            </div>
          </div>
        </div>
        {/* O valor sai da lista de dados e vira numero grande: e' o campo que
            se procura de relance numa ficha de venda, e no <dl> ele tinha o
            mesmo peso de "Email". */}
        <div className="text-right">
          <p className="eyebrow">Valor</p>
          <p className="tabular text-2xl font-semibold">{formatarMoeda(lead.valor.valorCents)}</p>
        </div>
      </header>

      {/* Duas colunas de conteudo REAL. Antes a direita tinha so' a linha do
          tempo, entao ela ficava com metade da tela quase vazia enquanto a
          esquerda empilhava seis blocos: dados, etiquetas, acoes, tarefas e
          scripts, numa coluna de ~370px. Tarefas e Scripts (os dois blocos
          largos, cheios de campo lado a lado) atravessaram para a direita.
          minmax(0,...) nas duas faixas: sem isso, uma tabela ou um <pre> longo
          dentro de um card estoura a coluna em vez de rolar. */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] lg:items-start">
        <div className="flex flex-col gap-5">
          <section className="surface rounded-2xl p-5">
            <h2 className="eyebrow mb-3">Contato</h2>
            <dl className="text-sm">
              {[
                ['Etapa', nomeEtapa.get(lead.valor.stageId) ?? '—'],
                ['Telefone', formatarTelefone(lead.valor.telefoneE164)],
                ['Email', lead.valor.email ?? '—'],
                ['Empresa', lead.valor.empresa ?? '—'],
                [
                  'Responsável',
                  lead.valor.responsavelId
                    ? nomePessoa.get(lead.valor.responsavelId) ?? '—'
                    : '—',
                ],
              ].map(([rotulo, valor]) => (
                <div
                  key={rotulo}
                  className="hairline flex items-baseline justify-between gap-3 border-b py-2 last:border-b-0"
                >
                  <dt className="shrink-0 text-muted-foreground">{rotulo}</dt>
                  {/* break-all so' no email: um endereco longo nao tem espaco
                      onde quebrar e empurraria a coluna inteira. */}
                  <dd className={`text-right ${rotulo === 'Email' ? 'break-all' : ''}`}>{valor}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="surface rounded-2xl p-5">
            <h2 className="eyebrow mb-3">Etiquetas</h2>
            <EditorEtiquetas
              leadId={lead.valor.id}
              atuais={lead.valor.etiquetas}
              conhecidas={etiquetas.valor}
            />
          </section>

          <section className="surface rounded-2xl p-5">
            <AcoesLead
              lead={lead.valor}
              etapas={pipeline.valor.etapas}
              membros={membros.valor}
              motivos={motivos.valor}
              etiquetasConhecidas={etiquetas.valor}
              podeTrocarResponsavel={papel !== 'vendedor'}
            />
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section className="surface rounded-2xl p-5">
            <PainelTarefas leadId={lead.valor.id} tarefas={tarefas.valor} agora={new Date()} />
          </section>

          {/* O unico bloco da ficha que fala com a rede externa (o Graph do
              Meta, para refrescar status de template nao-final). Fora do
              Suspense ele bloqueava o HTML inteiro: nome do lead, contato,
              tarefas e timeline esperavam a Meta responder. Streamado, o resto
              da ficha pinta na hora e o painel chega no mesmo response. */}
          <section className="surface rounded-2xl p-5">
            <Suspense
              fallback={
                <div className="flex flex-col gap-3" aria-busy="true">
                  <p className="eyebrow">Scripts</p>
                  <p className="text-sm text-muted-foreground">Carregando scripts…</p>
                </div>
              }
            >
              <BlocoScripts
                leadId={lead.valor.id}
                stageId={lead.valor.stageId}
                contexto={contextoScript}
                telefoneE164={lead.valor.telefoneE164}
              />
            </Suspense>
          </section>

          <section className="surface flex flex-col gap-4 rounded-2xl p-5">
            <h2 className="eyebrow">Linha do tempo</h2>
            <FormularioNota leadId={lead.valor.id} />
            <Timeline
              eventos={eventosVisiveis}
              nomeEtapa={nomeEtapa}
              nomePessoa={nomePessoa}
              nomePipeline={nomePipeline}
            />
            {/* Nao e' um "carregar mais": a janela existe para a ficha nao
                serializar a historia inteira, e quem precisa do registro
                antigo precisa dele por inteiro, num lugar que nao seja esta
                lista. Dizer que ha mais e' honesto; fingir que a lista e'
                completa nao. */}
            {temMaisEventos && (
              <p className="text-xs text-muted-foreground">
                Mostrando os {LIMITE_EVENTOS} eventos mais recentes.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
