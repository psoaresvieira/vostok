import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import { criarTarefaStoreDoServidor } from '@/lib/data/tarefas'
import { criarScriptStoreDoServidor, type Script } from '@/lib/data/scripts'
import { falha } from '@/lib/domain/resultado'
import { formatarMoeda, formatarTelefone } from '@/lib/domain/formato'
import { contextoDoLead } from '@/lib/domain/script'
import { codigoDoErroDoPainel } from '@/app/(app)/scripts/erros'
import { Timeline } from './timeline'
import { EditorEtiquetas } from './etiquetas'
import { FormularioNota } from './nota'
import { AcoesLead } from './acoes-lead'
import { PainelTarefas } from './tarefas'
import { PainelScripts } from './scripts'

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const contexto = await criarStoreDoServidor()
  if (!contexto.ok) redirect('/login')
  const { store, papel } = contexto.valor

  const lead = await store.buscarLead(id)
  if (!lead.ok) throw new Error(lead.erro)
  // Zero linhas por RLS chega aqui como null: e "nao encontrado", nunca 403.
  if (!lead.valor) notFound()

  const [pipeline, membros, eventos, etiquetas, motivos, tarefaStore, scriptStore] =
    await Promise.all([
      store.pipelinePadrao(),
      store.membros(),
      store.eventosDoLead(id),
      store.etiquetasDaConta(),
      store.motivosPerda(),
      criarTarefaStoreDoServidor(),
      criarScriptStoreDoServidor(),
    ])
  if (!pipeline.ok) throw new Error(pipeline.erro)
  if (!membros.ok) throw new Error(membros.erro)
  if (!eventos.ok) throw new Error(eventos.erro)
  if (!etiquetas.ok) throw new Error(etiquetas.erro)
  if (!motivos.ok) throw new Error(motivos.erro)
  if (!tarefaStore.ok) throw new Error(tarefaStore.erro)
  // scriptStore NAO entra na lista de `throw` acima de proposito: o painel de
  // scripts e' acessorio da ficha (mesma regra do sino/badge do layout), entao
  // uma falha dele degrada para painel com aviso, e nunca derruba a ficha
  // inteira — quem abriu o lead para mover etapa ou ler a timeline nao pode
  // perder a tela porque a biblioteca de scripts nao respondeu.
  const [tarefas, scriptsDaEtapa] = await Promise.all([
    tarefaStore.valor.doLead(id),
    scriptStore.ok
      ? scriptStore.valor.scripts.paraEtapa(lead.valor.stageId)
      : // `scriptStore.erro` NAO pode ir cru para a tela: a construcao do store
        // falha por caminhos fora do vocabulario de scripts —
        // `resolverContaAtiva` devolve `falha(error.message)`, a mensagem crua
        // do Postgres, e `sem_conta`. `mensagemDeErroScript` ecoa o codigo que
        // nao conhece, entao seria texto de banco de dados na ficha do lead.
        // O erro da CONSULTA, esse sim, ja e' sempre codigo do store e desce
        // como esta.
        Promise.resolve(falha<Script[]>(codigoDoErroDoPainel(scriptStore.erro))),
  ])
  if (!tarefas.ok) throw new Error(tarefas.erro)

  const nomeEtapa = new Map(pipeline.valor.etapas.map((e) => [e.id, e.nome]))
  const nomePessoa = new Map(membros.valor.map((m) => [m.id, m.nome]))
  // Um contexto so para a ficha inteira: os mapas acima ja existem para a
  // timeline, e `contextoDoLead` e' puro — nada aqui vai ao banco de novo.
  const contextoScript = contextoDoLead(lead.valor, nomeEtapa, nomePessoa)

  return (
    <div className="mx-auto grid max-w-4xl gap-6 p-6 md:grid-cols-[1fr_1.2fr]">
      <section className="flex flex-col gap-3">
        <Link href="/funil" className="text-sm underline">
          ← voltar ao funil
        </Link>
        <h1 className="text-2xl font-semibold">{lead.valor.nome}</h1>
        <dl className="text-sm">
          <div className="flex justify-between border-b py-1">
            <dt className="text-muted-foreground">Etapa</dt>
            <dd>{nomeEtapa.get(lead.valor.stageId) ?? '—'}</dd>
          </div>
          <div className="flex justify-between border-b py-1">
            <dt className="text-muted-foreground">Telefone</dt>
            <dd>{formatarTelefone(lead.valor.telefoneE164)}</dd>
          </div>
          <div className="flex justify-between border-b py-1">
            <dt className="text-muted-foreground">Email</dt>
            <dd>{lead.valor.email ?? '—'}</dd>
          </div>
          <div className="flex justify-between border-b py-1">
            <dt className="text-muted-foreground">Empresa</dt>
            <dd>{lead.valor.empresa ?? '—'}</dd>
          </div>
          <div className="flex justify-between border-b py-1">
            <dt className="text-muted-foreground">Valor</dt>
            <dd>{formatarMoeda(lead.valor.valorCents)}</dd>
          </div>
          <div className="flex justify-between border-b py-1">
            <dt className="text-muted-foreground">Responsável</dt>
            <dd>
              {lead.valor.responsavelId ? nomePessoa.get(lead.valor.responsavelId) ?? '—' : '—'}
            </dd>
          </div>
        </dl>

        <div>
          <h2 className="mb-1 text-sm font-semibold">Etiquetas</h2>
          <EditorEtiquetas
            leadId={lead.valor.id}
            atuais={lead.valor.etiquetas}
            conhecidas={etiquetas.valor}
          />
        </div>

        <AcoesLead
          lead={lead.valor}
          etapas={pipeline.valor.etapas}
          membros={membros.valor}
          motivos={motivos.valor}
          etiquetasConhecidas={etiquetas.valor}
          podeTrocarResponsavel={papel !== 'vendedor'}
        />

        <PainelTarefas leadId={lead.valor.id} tarefas={tarefas.valor} agora={new Date()} />

        <PainelScripts
          scripts={scriptsDaEtapa.ok ? scriptsDaEtapa.valor : []}
          contexto={contextoScript}
          telefoneE164={lead.valor.telefoneE164}
          erro={scriptsDaEtapa.ok ? null : scriptsDaEtapa.erro}
        />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">Linha do tempo</h2>
        <FormularioNota leadId={lead.valor.id} />
        <Timeline eventos={eventos.valor} nomeEtapa={nomeEtapa} nomePessoa={nomePessoa} />
      </section>
    </div>
  )
}
