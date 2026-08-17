import { FALHA_DE_CONEXAO, MENSAGEM_FALHA_DE_CONEXAO } from '@/lib/ui/acao'

// Mensagens dos codigos de erro que moverEtapaAction pode devolver, mais
// sem_permissao (de trocarResponsavel) — os dois chamadores da ficha do lead
// (acoes-lead.tsx) reusam o mesmo seletor de mensagem para as duas acoes.
// Unica fonte: nao duplicar este mapa em quadro.tsx nem em acoes-lead.tsx.
//
// Vive num arquivo separado de acoes.ts porque 'use server' exige que todo
// export de lá seja uma Server Action assincrona — nao da pra exportar um
// mapa ou uma funcao sincrona dali.
const MENSAGENS_ERRO: Record<string, string> = {
  motivo_perda_obrigatorio: 'Escolha o motivo da perda.',
  motivo_perda_invalido: 'Esse motivo de perda não pertence à sua conta.',
  etapa_invalida: 'Essa etapa não pertence ao seu funil.',
  lead_nao_encontrado: 'Você não tem acesso a esse lead.',
  sem_permissao: 'Só gestor ou admin troca o responsável.',
  responsavel_invalido: 'Esse responsável não faz parte da sua conta. Recarregue a página e escolha de novo.',
  [FALHA_DE_CONEXAO]: MENSAGEM_FALHA_DE_CONEXAO,
}

const ETIQUETAS_SALVAS = 'As etiquetas foram salvas, mas o lead continua na etapa anterior.'

// moverEtapaAction aplica as etiquetas ANTES de mover (o snapshot precisa gravar
// a etapa de origem). Sem transacao cobrindo as duas chamadas, o movimento pode
// falhar com as etiquetas ja no banco. O codigo devolvido carrega a causa
// original depois do ':' — dizer so "tente de novo" quando a causa e
// deterministica manda o usuario repetir para sempre um movimento que nunca vai
// passar.
const PREFIXO_ETIQUETAS_SALVAS = 'movimento_falhou_etiquetas_salvas:'

/** Causas em que repetir o mesmo movimento falha exatamente igual. */
const DETERMINISTICOS = new Set([
  'etapa_invalida',
  'motivo_perda_invalido',
  'motivo_perda_obrigatorio',
  'lead_nao_encontrado',
])

/** Marca uma falha de movimento cujas etiquetas ja foram gravadas. */
export function codigoEtiquetasSalvas(causa: string): string {
  return `${PREFIXO_ETIQUETAS_SALVAS}${causa}`
}

export function mensagemDeErro(codigo: string): string {
  if (codigo.startsWith(PREFIXO_ETIQUETAS_SALVAS)) {
    const causa = codigo.slice(PREFIXO_ETIQUETAS_SALVAS.length)
    const porque = MENSAGENS_ERRO[causa]
    if (porque && DETERMINISTICOS.has(causa)) return `${ETIQUETAS_SALVAS} ${porque}`
    return `${ETIQUETAS_SALVAS} Tente mover de novo.`
  }
  return MENSAGENS_ERRO[codigo] ?? codigo
}

// Mensagens dos codigos de erro que as actions de acoes-pipelines.ts (Task 4)
// podem devolver. Mapa local e nao entrada em MENSAGENS_ERRO: aquele mapa e
// consultado por mensagemDeErro/codigoEtiquetasSalvas para o vocabulario de
// lead/movimento, e misturar os dois so por estarem no mesmo arquivo
// confundiria qual action cada codigo pertence.
const MENSAGENS_PIPELINE: Record<string, string> = {
  pipeline_nao_encontrado: 'Essa pipeline não existe mais. Recarregue a página.',
  pipeline_padrao_nao_exclui: 'A pipeline padrão não pode ser excluída.',
  pipeline_com_leads: 'Essa pipeline ainda tem leads. Mova ou exclua os leads antes.',
  nome_obrigatorio: 'Dê um nome antes de salvar.',
  etapas_minimo_uma: 'Adicione ao menos uma etapa aberta.',
  [FALHA_DE_CONEXAO]: MENSAGEM_FALHA_DE_CONEXAO,
}

export function mensagemDePipeline(codigo: string): string {
  return MENSAGENS_PIPELINE[codigo] ?? codigo
}
