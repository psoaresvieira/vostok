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
  movimento_falhou_etiquetas_salvas:
    'As etiquetas foram salvas, mas o lead continua na etapa anterior. Tente mover de novo.',
  sem_permissao: 'Só gestor ou admin troca o responsável.',
}

export function mensagemDeErro(codigo: string): string {
  return MENSAGENS_ERRO[codigo] ?? codigo
}
