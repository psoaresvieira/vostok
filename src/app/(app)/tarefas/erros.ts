import { FALHA_DE_CONEXAO, MENSAGEM_FALHA_DE_CONEXAO } from '@/lib/ui/acao'

// Mapa unico dos codigos de tarefas.acoes, importado pela ficha do lead
// (funil/drawer/tarefas.tsx, Task 5) e pela tela /tarefas (Task 6). Vive fora
// de acoes.ts porque 'use server' exige que todo export de la seja uma
// Server Action assincrona — nao da pra exportar um mapa dali. Nao criar um
// mapa local em cada tela: src/lib/ui/acao.ts:10 ja registra que este app
// traduz erro em quatro convencoes diferentes; tarefas fica numa so.
const MENSAGENS_ERRO: Record<string, string> = {
  titulo_vazio: 'Escreva um título antes de salvar.',
  prazo_invalido: 'Esse prazo não é uma data válida.',
  tarefa_nao_encontrada: 'Essa tarefa não existe mais ou você não tem acesso a ela.',
  lead_nao_encontrado: 'Você não tem acesso a esse lead.',
  sem_sessao: 'Sua sessão expirou. Entre novamente.',
  erro_ao_criar_tarefa: 'Não foi possível criar a tarefa. Tente de novo.',
  erro_ao_carregar_tarefas: 'Não foi possível carregar as tarefas. Tente de novo.',
  erro_ao_atualizar_tarefa: 'Não foi possível atualizar a tarefa. Tente de novo.',
  // Codigo proprio para "a escrita que o usuario pediu deu certo, so o
  // registro na timeline falhou". Sem ele a tela dizia "Nao foi possivel
  // atualizar a tarefa" para uma tarefa que JA estava concluida no banco —
  // mensagem falsa, que convida o usuario a clicar de novo e re-carimbar.
  // A chave e literal, como todas as outras deste mapa, e nao importada de
  // TAREFA_CONCLUIDA_SEM_EVENTO (lib/data/tarefas.ts) de proposito: este
  // arquivo e importado por componente cliente, e importar valor de
  // lib/data/tarefas.ts arrastaria next/headers (via supabase/servidor) para
  // o bundle do browser. So o lado servidor (acoes.ts) usa a constante.
  tarefa_concluida_sem_evento:
    'Tarefa concluída. Não conseguimos registrá-la na linha do tempo do lead.',
  [FALHA_DE_CONEXAO]: MENSAGEM_FALHA_DE_CONEXAO,
}

export function mensagemDeErroTarefa(codigo: string): string {
  return MENSAGENS_ERRO[codigo] ?? codigo
}
