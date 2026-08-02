import { FALHA_DE_CONEXAO, MENSAGEM_FALHA_DE_CONEXAO } from '@/lib/ui/acao'

// Mapa unico dos codigos de tarefas.acoes, importado pela ficha do lead
// (leads/[id]/tarefas.tsx, Task 5) e pela tela /tarefas (Task 6). Vive fora
// de acoes.ts porque 'use server' exige que todo export de la seja uma
// Server Action assincrona — nao da pra exportar um mapa dali. Nao criar um
// mapa local em cada tela: src/lib/ui/acao.ts:10 ja registra que este app
// traduz erro em quatro convencoes diferentes; tarefas fica numa so.
const MENSAGENS_ERRO: Record<string, string> = {
  titulo_vazio: 'Escreva um titulo antes de salvar.',
  prazo_invalido: 'Esse prazo nao e uma data valida.',
  tarefa_nao_encontrada: 'Essa tarefa nao existe mais ou voce nao tem acesso a ela.',
  lead_nao_encontrado: 'Voce nao tem acesso a esse lead.',
  sem_sessao: 'Sua sessao expirou. Entre novamente.',
  erro_ao_criar_tarefa: 'Nao foi possivel criar a tarefa. Tente de novo.',
  erro_ao_carregar_tarefas: 'Nao foi possivel carregar as tarefas. Tente de novo.',
  erro_ao_atualizar_tarefa: 'Nao foi possivel atualizar a tarefa. Tente de novo.',
  [FALHA_DE_CONEXAO]: MENSAGEM_FALHA_DE_CONEXAO,
}

export function mensagemDeErroTarefa(codigo: string): string {
  return MENSAGENS_ERRO[codigo] ?? codigo
}
