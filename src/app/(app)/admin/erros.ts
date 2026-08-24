// Mesma convencao de (auth)/erros.ts: traduzir codigo aqui, nunca no componente.
const MENSAGENS_ERRO: Record<string, string> = {
  nome_obrigatorio: 'Informe o nome da conta.',
  email_invalido: 'Email inválido.',
  entrada_invalida: 'Preencha o nome da conta e o email do cliente.',
  sem_permissao: 'Você não tem permissão para isso.',
  sem_sessao: 'Sessão expirada. Entre novamente.',
  convite_invalido: 'Convite não encontrado.',
  convite_ja_aceito: 'Este convite já foi usado — a conta já tem acesso.',
}

export function mensagemDeErro(codigo: string): string {
  return MENSAGENS_ERRO[codigo] ?? codigo
}
