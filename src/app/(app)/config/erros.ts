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
  responsavel_invalido: 'Esse responsável não faz parte da sua conta. Recarregue a página e escolha de novo.',
  conexao_expirada: 'A conexão com o Meta expirou. Clique em "Conectar Facebook" de novo.',
  meta_indisponivel: 'O Facebook não respondeu. Tente de novo em alguns minutos.',
  pagina_nao_encontrada: 'Essa página não está mais disponível na sua conta do Facebook.',
  page_ja_conectada: 'Essa página do Facebook já está conectada a outra conta do CRM.',
  page_id_invalido: 'O Facebook não devolveu o identificador dessa página. Tente conectar de novo.',
  fonte_nao_encontrada: 'Essa integração não existe mais. Recarregue a página.',
  segredo_vazio: 'O segredo não pode ficar em branco.',
}

export function mensagemDeErro(codigo: string): string {
  return MENSAGENS_ERRO[codigo] ?? codigo
}
