import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import { criarTarefaStoreDoServidor } from '@/lib/data/tarefas'
import { criarScriptStoreDoServidor, type Script } from '@/lib/data/scripts'
import {
  criarDisparoServico,
  criarTemplateStoreDoServidor,
  type TemplateWhatsApp,
} from '@/lib/data/templates'
import { falha } from '@/lib/domain/resultado'
import { formatarMoeda, formatarTelefone } from '@/lib/domain/formato'
import { contextoDoLead } from '@/lib/domain/script'
import { codigoDoErroDoPainel } from '@/app/(app)/scripts/erros'
import { statusEhFinal, templateComStatusFresco } from '@/app/(app)/scripts/status-template'
import { Timeline } from './timeline'
import { EditorEtiquetas } from './etiquetas'
import { FormularioNota } from './nota'
import { AcoesLead } from './acoes-lead'
import { PainelTarefas } from './tarefas'
import { PainelScripts } from './scripts'

/**
 * Os templates dos scripts que o painel vai pintar, com o status fresco dos que
 * ainda podem mudar.
 *
 * TUDO aqui degrada para lista vazia, e nunca lanca: sem template so' se perde
 * o botao de enviar (o painel continua com previa, Copiar e wa.me), e derrubar
 * a ficha inteira porque o Meta nao respondeu seria trocar uma funcionalidade
 * que falhou por duas — mesma regra que ja vale para o proprio painel.
 *
 * SEGURANCA — os `templateId` que a RPC de status recebe vem SEMPRE das linhas
 * que o store da conta ativa acabou de ler (`templateComStatusFresco` re-le por
 * `doScript`), nunca de id que chegou por request: a RPC e' security definer
 * autorizada so pelo segredo e escreve em qualquer linha cujo id receber.
 */
async function templatesDoPainel(scripts: Script[]): Promise<TemplateWhatsApp[]> {
  if (scripts.length === 0) return []

  const contexto = await criarTemplateStoreDoServidor()
  if (!contexto.ok) return []

  // Uma consulta para os N scripts do painel, e nao uma por script.
  const lidos = await contexto.valor.templates.dosScripts(scripts.map((s) => s.id))
  if (!lidos.ok) return []

  // Nada em estado nao-final: ninguem precisa da credencial, e a ficha nao
  // gasta um round-trip a RPC por render. E' o caso comum depois da aprovacao.
  const abertos = lidos.valor.filter((t) => !statusEhFinal(t.status))
  if (abertos.length === 0) return lidos.valor

  const servico = criarDisparoServico()
  if (!servico.ok) return lidos.valor
  const credencial = await servico.valor.credencial(contexto.valor.contaId)
  // Sem credencial nao ha o que consultar: o status gravado e' o melhor que
  // existe, e chamar a rotina de refresh so gastaria uma leitura a mais por
  // template para devolver exatamente estas linhas.
  if (!credencial.ok) return lidos.valor

  const frescos = await Promise.all(
    abertos.map((t) =>
      templateComStatusFresco(contexto.valor.templates, servico.valor, t.scriptId, {
        token: credencial.valor.token,
        wabaId: credencial.valor.wabaId,
      }),
    ),
  )

  const porScript = new Map(lidos.valor.map((t) => [t.scriptId, t]))
  // `null` (leitura que falhou no meio do caminho) mantem a linha ja lida: um
  // status velho e' uma tela desatualizada; sumir com o template e' um botao
  // que desaparece sem explicacao.
  for (const fresco of frescos) if (fresco) porScript.set(fresco.scriptId, fresco)
  return [...porScript.values()]
}

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

  // Depende dos scripts que o painel vai pintar, entao vem depois do
  // Promise.all acima — e nunca com `throw`, pelo mesmo motivo do painel.
  const templates = await templatesDoPainel(scriptsDaEtapa.ok ? scriptsDaEtapa.valor : [])

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
          leadId={lead.valor.id}
          scripts={scriptsDaEtapa.ok ? scriptsDaEtapa.valor : []}
          contexto={contextoScript}
          telefoneE164={lead.valor.telefoneE164}
          templates={templates}
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
