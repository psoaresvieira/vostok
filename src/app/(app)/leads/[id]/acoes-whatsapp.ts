'use server'

import { revalidatePath } from 'next/cache'
import { criarScriptStoreDoServidor } from '@/lib/data/scripts'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import { criarDisparoServico, criarTemplateStoreDoServidor } from '@/lib/data/templates'
import { contextoDoLead, preencherPosicional, valoresPosicionais } from '@/lib/domain/script'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import { whatsappGraph } from '@/lib/integracoes/fabrica'
import { estaDesatualizado } from '@/app/(app)/scripts/desatualizado'
import { codigoDoErroDoTemplate } from '@/app/(app)/scripts/erros'

/**
 * Envia o script como template do WhatsApp para o lead.
 *
 * SEGURANCA — a assinatura e' `(leadId, scriptId)`, e nunca recebe id de
 * template, nome no Meta, corpo ou valores. Tudo isso e' resolvido AQUI, no
 * servidor, pelo store da conta ativa: o template sai de
 * `templates.doScript(scriptId)`, que ja filtra `account_id`, e o texto sai do
 * snapshot gravado nessa linha. Aceitar qualquer um desses pelo request
 * transformaria a action em "mande a mensagem que eu escrever para o telefone
 * que eu apontar", com o token de WhatsApp de uma conta que talvez nem seja a
 * do chamador.
 *
 * Sem gate de papel, de proposito: vendedor DISPARA (spec §10) — quem nao pode
 * e' submeter template novo, que e' outra action. A guarda do lead e' a RLS de
 * `leads`, que ja restringe o vendedor aos leads dele: um leadId alheio volta
 * como `lead_nao_encontrado`.
 *
 * Ordem normativa (task-6-brief.md): (1) sessao + stores; (2) lead visivel com
 * telefone; (3) template aprovado; (4) snapshot batendo com o conteudo atual;
 * (5) valores sem lacuna; (6) credencial; (7) envio; (8) evento; (9)
 * revalidate. As guardas 2 a 5 recusam ANTES de qualquer IO externo — e' o que
 * garante que uma lacuna do lead nao custa round-trip ao Meta nem cobra uma
 * mensagem que nao vai sair.
 */
export async function enviarWhatsApp(
  leadId: string,
  scriptId: string,
): Promise<Resultado<void>> {
  // (1) Os tres stores em paralelo: nenhum depende do outro, e todos resolvem a
  // mesma conta ativa.
  const [base, contextoScripts, contextoTemplates] = await Promise.all([
    criarStoreDoServidor(),
    criarScriptStoreDoServidor(),
    criarTemplateStoreDoServidor(),
  ])
  // codigoDoErroDoTemplate em todo forward: a construcao dos stores falha por
  // caminhos de outro vocabulario (`resolverContaAtiva` devolve a mensagem CRUA
  // do Postgres, e 'sem_conta'), e nenhum deles pode chegar a tela como veio.
  if (!base.ok) return falha(codigoDoErroDoTemplate(base.erro))
  if (!contextoScripts.ok) return falha(codigoDoErroDoTemplate(contextoScripts.erro))
  if (!contextoTemplates.ok) return falha(codigoDoErroDoTemplate(contextoTemplates.erro))
  const { store } = base.valor

  // (2) Zero linhas por RLS chega como null: e' "nao encontrado", nunca 403 —
  // mesma convencao da pagina da ficha.
  const lead = await store.buscarLead(leadId)
  if (!lead.ok) return falha(codigoDoErroDoTemplate(lead.erro))
  if (!lead.valor) return falha('lead_nao_encontrado')
  const telefoneE164 = lead.valor.telefoneE164
  if (!telefoneE164) return falha('whatsapp_sem_telefone')

  // (3) O template SEMPRE da conta ativa, pelo scriptId. Status diferente de
  // 'approved' (inclusive pending, rejected e o que o Meta invente) e' recusa:
  // o Graph so aceita template aprovado, e um envio que ele recusaria depois
  // custaria um round-trip para dizer a mesma coisa.
  const template = await contextoTemplates.valor.templates.doScript(scriptId)
  if (!template.ok) return falha(codigoDoErroDoTemplate(template.erro))
  if (!template.valor || template.valor.status !== 'approved') {
    return falha('template_nao_aprovado')
  }

  // (4) A MESMA funcao que desabilita o botao na tela (scripts/desatualizado.ts)
  // — a tela pode estar velha, e o servidor e' quem decide de verdade.
  const script = await contextoScripts.valor.scripts.buscar(scriptId)
  if (!script.ok) return falha(codigoDoErroDoTemplate(script.erro))
  if (!script.valor) return falha('script_nao_encontrado')
  if (estaDesatualizado(script.valor.conteudo, template.valor)) {
    return falha('template_desatualizado')
  }

  // (5) Os valores saem do MAPA do snapshot lido na ordem do template — nao do
  // conteudo atual, nao da tela. Qualquer posicao vazia aborta com
  // 'whatsapp_lacunas': um array mais curto que os {{N}} do corpo desalinha
  // todo slot seguinte silenciosamente do lado do Meta.
  const [pipeline, membros] = await Promise.all([store.pipelinePadrao(), store.membros()])
  if (!pipeline.ok) return falha(codigoDoErroDoTemplate(pipeline.erro))
  if (!membros.ok) return falha(codigoDoErroDoTemplate(membros.erro))
  const contexto = contextoDoLead(
    lead.valor,
    new Map(pipeline.valor.etapas.map((e) => [e.id, e.nome])),
    new Map(membros.valor.map((m) => [m.id, m.nome])),
  )
  const valores = valoresPosicionais(template.valor.mapa, contexto)
  if (!valores.ok) return falha(valores.erro)

  // (6) Cliente anon + segredo: o token do WhatsApp nao e' alcancavel por
  // sessao nenhuma (0019).
  const servico = criarDisparoServico()
  if (!servico.ok) return falha(codigoDoErroDoTemplate(servico.erro))
  const credencial = await servico.valor.credencial(contextoTemplates.valor.contaId)
  if (!credencial.ok) return falha(codigoDoErroDoTemplate(credencial.erro))

  // (7) Nome e IDIOMA da linha gravada, nunca de uma constante de hoje: um
  // template aprovado ontem continua sendo enviado no idioma com que o Meta o
  // aprovou.
  const enviado = await whatsappGraph().enviarTemplate(
    credencial.valor.token,
    credencial.valor.phoneNumberId,
    telefoneE164,
    {
      nome: template.valor.nomeMeta,
      idioma: template.valor.idioma,
      valores: valores.valor,
    },
  )
  if (!enviado.ok) return falha(codigoDoErroDoTemplate(enviado.erro))

  // (8) O texto do evento sai do SNAPSHOT preenchido — o mesmo corpo que o Meta
  // aprovou, com os mesmos valores que acabaram de ir para o Graph. Nao ha
  // quarta via de montagem de texto: o preview/Copiar/wa.me usam
  // textoPlano(interpolar(...)) e a comutacao entre os dois caminhos tem teste.
  const texto = preencherPosicional(template.valor.corpoPosicional, valores.valor)
  const evento = await store.registrarEnvioWhatsApp(leadId, {
    template: template.valor.nomeMeta,
    texto,
  })

  // (9) Revalida ANTES de decidir o retorno, e nos dois caminhos: a mensagem FOI
  // para o cliente. Se so o evento falhou, a ficha ainda precisa recarregar (o
  // codigo proprio conta a verdade — enviou, nao registrou), e nunca um erro
  // que sugira tentar de novo um envio que ja aconteceu.
  revalidatePath(`/leads/${leadId}`)
  if (!evento.ok) return falha('whatsapp_enviado_sem_evento')
  return ok(undefined)
}
