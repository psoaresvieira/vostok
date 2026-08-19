import { criarScriptStoreDoServidor, type Script } from '@/lib/data/scripts'
import {
  criarDisparoServico,
  criarTemplateStoreDoServidor,
  type TemplateWhatsApp,
} from '@/lib/data/templates'
import { falha } from '@/lib/domain/resultado'
import type { ContextoScript } from '@/lib/domain/script'
import { codigoDoErroDoPainel } from '@/app/(app)/scripts/erros'
import { statusEhFinal, templateComStatusFresco } from '@/app/(app)/scripts/status-template'
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

/**
 * O painel de scripts como um bloco que a ficha do lead STREAMA.
 *
 * Vive num componente proprio, e nao inline no page.tsx, porque este e' o unico
 * pedaco da ficha que pode falar com a rede EXTERNA: `templatesDoPainel`
 * consulta o Graph do Meta para refrescar o status de template nao-final.
 * Dentro do corpo da pagina, esse round-trip bloqueava o HTML inteiro — nome do
 * lead, contato, etiquetas, tarefas e timeline esperavam a Meta responder, e um
 * dia ruim do Graph era uma ficha em branco por segundos.
 *
 * Envolvido em <Suspense> pelo chamador, o resto da ficha pinta imediatamente e
 * este bloco chega depois, no mesmo response. Nada de autorizacao ou de
 * degradacao mudou: as regras estao todas aqui dentro, iguais.
 */
export async function BlocoScripts({
  leadId,
  stageId,
  contexto,
  telefoneE164,
}: {
  leadId: string
  stageId: string
  contexto: ContextoScript
  telefoneE164: string | null
}) {
  const scriptStore = await criarScriptStoreDoServidor()

  // scriptStore NAO derruba a ficha: o painel de scripts e' acessorio (mesma
  // regra do sino/badge do layout), entao uma falha dele degrada para painel
  // com aviso.
  //
  // `scriptStore.erro` NAO pode ir cru para a tela: a construcao do store
  // falha por caminhos fora do vocabulario de scripts — `resolverContaAtiva`
  // devolve `falha(error.message)`, a mensagem crua do Postgres, e
  // `sem_conta`. `mensagemDeErroScript` ecoa o codigo que nao conhece, entao
  // seria texto de banco de dados na ficha do lead. O erro da CONSULTA, esse
  // sim, ja e' sempre codigo do store e desce como esta.
  const scriptsDaEtapa = scriptStore.ok
    ? await scriptStore.valor.scripts.paraEtapa(stageId)
    : falha<Script[]>(codigoDoErroDoPainel(scriptStore.erro))

  const templates = await templatesDoPainel(scriptsDaEtapa.ok ? scriptsDaEtapa.valor : [])

  return (
    <PainelScripts
      leadId={leadId}
      scripts={scriptsDaEtapa.ok ? scriptsDaEtapa.valor : []}
      contexto={contexto}
      telefoneE164={telefoneE164}
      templates={templates}
      erro={scriptsDaEtapa.ok ? null : scriptsDaEtapa.erro}
    />
  )
}
