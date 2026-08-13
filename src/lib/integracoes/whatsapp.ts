import type { Resultado } from '@/lib/domain/resultado'

/** O que o Meta diz sobre um numero de WhatsApp Business, direto do Graph. */
export type DadosDoNumero = { numeroExibicao: string; nomeVerificado: string }

/** O que o Meta devolve ao aceitar uma submissao de template para revisao. */
export type TemplateSubmetido = { idMeta: string; status: string }

/** O que o Meta diz sobre o estado atual de um template ja submetido. */
export type StatusTemplate = { status: string; motivo: string | null }

/**
 * Prova, antes de gravar credencial nenhuma, que `token` de fato le
 * `phoneNumberId` no Graph. Port, e nao fetch espalhado, para que nenhum
 * teste automatizado (nem o E2E) toque a rede — mesma razao de existir que
 * `MetaGraph` em meta.ts.
 */
export interface WhatsAppGraph {
  /**
   * Prova que `token` le `phoneNumberId` e devolve o que o Meta diz sobre o
   * numero. Falhas viram codigo: 'token_whatsapp_invalido' (o Graph recusou a
   * credencial ou o id) ou 'whatsapp_indisponivel' (rede/5xx).
   */
  dadosDoNumero(token: string, phoneNumberId: string): Promise<Resultado<DadosDoNumero>>

  /**
   * Submete um template para revisao do Meta. Falhas viram codigo:
   * 'template_recusado_pelo_meta' (4xx — o Graph recusou o template) ou
   * 'whatsapp_indisponivel' (rede/5xx).
   */
  submeterTemplate(
    token: string,
    wabaId: string,
    d: { nome: string; idioma: string; categoria: 'marketing' | 'utility'; corpo: string },
  ): Promise<Resultado<TemplateSubmetido>>

  /**
   * Consulta o estado atual de um template pelo nome (match EXATO — o `name=`
   * do Graph e prefix-match e paginado, e a implementacao real segue
   * `paging.next` ate achar). Falhas viram codigo: 'template_nao_encontrado'
   * (todas as paginas percorridas sem o nome exato) ou 'whatsapp_indisponivel'
   * (rede/5xx, qualquer outra recusa do Graph, teto de paginas atingido ou
   * `paging.next` malformado — casos em que "nao existe" seria afirmacao sem
   * prova, entao a falha e transitoria de proposito).
   */
  statusDoTemplate(
    token: string,
    wabaId: string,
    nome: string,
  ): Promise<Resultado<StatusTemplate>>

  /**
   * Apaga um template pelo nome. Falha vira codigo: 'whatsapp_indisponivel'
   * (rede/5xx ou qualquer recusa do Graph).
   */
  apagarTemplate(token: string, wabaId: string, nome: string): Promise<Resultado<void>>

  /**
   * Envia um template aprovado a um destinatario. Falhas viram codigo:
   * 'envio_recusado' (4xx — o Graph recusou o envio, ex.: template nao
   * aprovado) ou 'whatsapp_indisponivel' (rede/5xx).
   */
  enviarTemplate(
    token: string,
    phoneNumberId: string,
    e164Destino: string,
    d: { nome: string; idioma: string; valores: string[] },
  ): Promise<Resultado<{ idMensagem: string }>>
}
