import type { DisparoServico, TemplateStore, TemplateWhatsApp } from '@/lib/data/templates'
import { whatsappGraph } from '@/lib/integracoes/fabrica'
import type { WhatsAppGraph } from '@/lib/integracoes/whatsapp'

/** O que o Graph precisa para falar de templates de uma WABA. */
export type CredencialDisparo = { token: string; wabaId: string }

/** Estados finais: o Meta nao os revisita, entao consultar de novo so gastaria
 * um round-trip por render. Todo o resto (pending, e o que o Meta invente) e'
 * consultado sob demanda. */
const FINAIS = new Set(['approved', 'rejected'])

/**
 * O status ja e' definitivo? Exportado para quem monta LISTA de templates (a
 * ficha do lead renderiza N scripts) poder decidir, antes de qualquer IO, se
 * ainda ha o que consultar — e assim nem pedir a credencial quando todos os
 * templates da tela ja estao em estado final.
 */
export function statusEhFinal(status: string): boolean {
  return FINAIS.has(status)
}

/**
 * Intervalo minimo entre duas consultas ao Meta pelo MESMO template.
 *
 * A ficha do lead renderiza N scripts, e cada template nao-final dispararia uma
 * consulta ao Graph mais uma escrita pela RPC a cada render — inclusive no F5
 * que o usuario da' um segundo depois, e em cada uma das abas que ele deixou
 * abertas. Analise do Meta leva minutos ou horas; um minuto de folga nao atrasa
 * nada que o usuario perceba e transforma "N x cada render" em "N x por
 * minuto".
 */
const INTERVALO_MINIMO_CONSULTA_MS = 60_000

/**
 * Le o template de um script e, quando o status ainda pode mudar, atualiza-o
 * contra o Meta ANTES de a pagina renderizar — e persiste o resultado.
 *
 * Modulo de servidor (usa `whatsappGraph()` e o `DisparoServico`, que carrega o
 * segredo de ingestao): nunca importar de componente cliente. Vive fora do
 * page.tsx porque a ficha do lead (Task 6) precisa exatamente do mesmo passo.
 *
 * SEGURANCA — o `templateId` que vai para `atualizarStatus` vem SEMPRE da linha
 * que `doScript` acabou de ler na conta ativa, nunca de um id que chegou por
 * request. A RPC e' `security definer` autorizada so pelo segredo do servidor:
 * ela escreve em QUALQUER linha cujo id receber, sem olhar RLS. Passar um id de
 * origem externa transformaria esta funcao em "grave 'approved' no template que
 * eu apontar".
 *
 * DEGRADACAO — qualquer ponta que falhe (leitura, credencial, Graph, RPC)
 * devolve o que estava gravado. Um status velho e' uma tela desatualizada; uma
 * excecao aqui e' a pagina inteira do script sem carregar.
 */
export async function templateComStatusFresco(
  templates: TemplateStore,
  servico: DisparoServico,
  scriptId: string,
  credencial: CredencialDisparo | null,
  graph: WhatsAppGraph = whatsappGraph(),
): Promise<TemplateWhatsApp | null> {
  const lido = await templates.doScript(scriptId)
  if (!lido.ok) return null
  const template = lido.valor
  if (!template) return null

  if (FINAIS.has(template.status)) return template
  // Sem conexao de WhatsApp nao ha o que consultar: a tela ja aponta para
  // /config, e o status gravado e' o melhor que existe.
  if (!credencial) return template

  // Consultado ha pouco: devolve o gravado, sem round-trip e sem escrita. O
  // carimbo e' o do BANCO (`now()` da RPC), entao a folga vale para todos os
  // renders de todas as abas e nao so' para os deste processo. Carimbo no
  // futuro (relogio do banco adiantado) tambem cai aqui — e' "fresco demais",
  // que e' o lado seguro: o proximo minuto corrige.
  const consultadoEm = template.statusConsultadoEm
  if (consultadoEm && Date.now() - consultadoEm.getTime() < INTERVALO_MINIMO_CONSULTA_MS) {
    return template
  }

  const fresco = await graph.statusDoTemplate(
    credencial.token,
    credencial.wabaId,
    template.nomeMeta,
  )
  if (!fresco.ok) return template

  const status = fresco.valor.status.toLowerCase()
  const persistido = await servico.atualizarStatus(
    // `template.id`, da linha lida acima — ver o bloco SEGURANCA.
    template.id,
    status,
    fresco.valor.motivo,
  )
  // Nao persistiu: devolve o gravado, e nao o fresco. Mostrar 'approved' numa
  // tela cujo banco ainda diz 'pending' faria o botao de envio aparecer para
  // um estado que o proximo render desfaz.
  if (!persistido.ok) return template

  // O carimbo e' o que a RPC gravou (`now()` do banco). `new Date()` daqui e'
  // aproximacao do mesmo instante, e so alimenta o "consultado ha X" deste
  // render — o valor autoritativo volta na proxima leitura.
  return {
    ...template,
    status,
    motivoRejeicao: fresco.valor.motivo,
    statusConsultadoEm: new Date(),
  }
}
