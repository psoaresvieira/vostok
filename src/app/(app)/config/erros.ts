// Mensagens dos codigos de erro que as Server Actions de configuracao podem
// devolver. Mesma convencao do funil (ver funil/erros.ts): traduzir o codigo
// aqui, nunca no componente, e nunca mostrar o codigo cru na tela.
const MENSAGENS_ERRO: Record<string, string> = {
  nome_obrigatorio: 'Dê um nome antes de salvar.',
  email_invalido: 'Email inválido.',
  sem_permissao: 'Só administradores acessam a configuração.',
  sem_sessao: 'Sua sessão expirou. Entre novamente.',
  sem_conta: 'Você ainda não está em nenhuma conta.',
  pipeline_nao_encontrado: 'Não encontramos o funil da sua conta.',
}

export function mensagemDeErro(codigo: string): string {
  return MENSAGENS_ERRO[codigo] ?? codigo
}
