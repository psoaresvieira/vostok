import { FALHA_DE_CONEXAO, MENSAGEM_FALHA_DE_CONEXAO } from '@/lib/ui/acao'

// Mapa unico dos codigos de scripts/acoes.ts e do SupabaseScriptStore,
// importado pelo editor (editor.tsx) e pela biblioteca (page.tsx). Vive fora de
// acoes.ts pelo mesmo motivo de tarefas/erros.ts: 'use server' exige que todo
// export de la seja uma Server Action assincrona, entao nao da pra exportar um
// mapa dali. Chaves literais, e nunca importadas de lib/data/scripts.ts: este
// arquivo e' importado por componente cliente, e importar valor daquele modulo
// arrastaria next/headers (via supabase/servidor) para o bundle do browser.
const MENSAGENS_ERRO: Record<string, string> = {
  titulo_vazio: 'Escreva um título antes de salvar.',
  conteudo_vazio: 'Escreva o conteúdo do script antes de salvar.',
  tags_demais: 'No máximo 10 tags por script.',
  etapa_invalida:
    'Essa etapa não existe mais — pode ter sido excluída. Recarregue a página e escolha outra.',
  script_nao_encontrado: 'Esse script não existe mais ou você não tem acesso a ele.',
  sem_permissao: 'Só administradores e gestores editam scripts.',
  sem_sessao: 'Sua sessão expirou. Entre novamente.',
  erro_ao_salvar_script: 'Não foi possível salvar o script. Tente de novo.',
  erro_ao_carregar_scripts: 'Não foi possível carregar os scripts. Tente de novo.',
  [FALHA_DE_CONEXAO]: MENSAGEM_FALHA_DE_CONEXAO,
}

export function mensagemDeErroScript(codigo: string): string {
  return MENSAGENS_ERRO[codigo] ?? codigo
}
