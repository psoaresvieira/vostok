// Mensagens dos codigos de erro que as Server Actions de configuracao podem
// devolver. Mesma convencao do funil (ver funil/erros.ts): traduzir o codigo
// aqui, nunca no componente, e nunca mostrar o codigo cru na tela.
import { FALHA_DE_CONEXAO, MENSAGEM_FALHA_DE_CONEXAO } from '@/lib/ui/acao'

const MENSAGENS_ERRO: Record<string, string> = {
  [FALHA_DE_CONEXAO]: MENSAGEM_FALHA_DE_CONEXAO,
  nome_obrigatorio: 'Dê um nome antes de salvar.',
  email_invalido: 'Email inválido.',
  ordem_invalida: 'A nova ordem não corresponde às etapas deste funil. Recarregue a página e tente de novo.',
  nao_encontrado: 'Esse item não existe mais. Recarregue a página.',
  sem_permissao: 'Só administradores acessam a configuração.',
  sem_sessao: 'Sua sessão expirou. Entre novamente.',
  sem_conta: 'Você ainda não está em nenhuma conta.',
  pipeline_nao_encontrado: 'Não encontramos o funil da sua conta.',
}

export function mensagemDeErro(codigo: string): string {
  return MENSAGENS_ERRO[codigo] ?? codigo
}
