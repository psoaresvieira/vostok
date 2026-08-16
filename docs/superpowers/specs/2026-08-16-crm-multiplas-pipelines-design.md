# Múltiplas pipelines no funil — design

Data: 2026-08-16
Status: aprovado em conversa; aguardando revisão do spec escrito

## Objetivo

O funil ganha uma barra lateral com a lista de pipelines da conta. Qualquer
membro cria quantas pipelines quiser, cada uma com suas próprias etapas, e
alterna entre elas sem sair da aba Funil. O banco já suporta isso desde a
fundação (`pipelines`, `stages` por pipeline, `lead.pipelineId`); o trabalho é
destravar a UI e ajustar as políticas de escrita.

## Decisões tomadas (com Pedro)

1. **Permissão: todo mundo.** Qualquer membro da conta cria, renomeia e exclui
   pipelines. A RLS de escrita de `pipelines` e `stages` passa de
   admin-somente para membro-da-conta.
2. **Criação com escolha de etapas.** O modal de criação pede o nome e a lista
   de etapas abertas (adicionar, remover, reordenar; mínimo 1). **Ganho e
   Perdido são acrescentadas automaticamente ao final** — funil, métricas e
   modal de perda dependem desses dois tipos existirem em toda pipeline.
3. **Ingestão continua na padrão.** Webhooks Meta/Google seguem entregando na
   pipeline padrão da conta. Pipeline de destino por fonte fica para depois.

## Fora de escopo (v1)

- Mover lead entre pipelines.
- Métricas por pipeline (a aba Métricas continua lendo a padrão).
- Pipeline de destino configurável por fonte conectada.
- Editar etapas de pipelines não-padrão pela engrenagem (a config continua
  mostrando só a padrão; etapas de pipelines novas são definidas na criação).

## Arquitetura: pipeline na URL

A pipeline ativa vive na URL: `/funil?pipeline=<id>`. Sem o parâmetro, a
padrão. Segue o padrão dos filtros existentes (`?dias=`, `?origem=`): a barra
lateral é um server component que renderiza links, o link é compartilhável e
não há estado de seleção no cliente. Parâmetro apontando para pipeline
inexistente ou de outra conta: a página cai na padrão (mesmo comportamento de
filtro inválido, sem erro).

Os filtros existentes preservam o parâmetro `pipeline` ao navegar (hoje eles
montam a query string do zero).

## UI

### Barra lateral

Coluna fixa à esquerda do quadro, dentro da aba Funil. Conteúdo:

- Lista de pipelines: padrão primeiro, demais por data de criação. A ativa
  destacada. Cada item é um link para `/funil?pipeline=<id>` (a padrão linka
  para `/funil` limpo).
- Menu por item (kebab): **Renomear** e **Excluir**.
- Botão **«+ Nova pipeline»** ao final da lista.
- Visível para todos os papéis.

### Modal de criação

- Campo nome (obrigatório, não vazio).
- Lista editável de etapas abertas: começa com uma sugestão (as 5 abertas da
  pipeline inicial), permite adicionar, remover e reordenar; mínimo 1 etapa
  aberta; nomes não vazios.
- Texto fixo informando que Ganho e Perdido serão acrescentadas ao final.
- Ao criar: navega para `/funil?pipeline=<id-novo>`.

### Renomear e excluir

- Renomear: modal simples com o nome atual preenchido; livre para qualquer
  pipeline, inclusive a padrão.
- Excluir: bloqueado para a pipeline padrão (a ingestão entrega nela) e para
  pipeline com leads — o modal explica o motivo e não oferece força-bruta.
  Se a pipeline excluída era a ativa, navega para `/funil`.

## Banco e RLS

Migration nova (`0025_pipelines_por_membro.sql`):

- Troca as políticas de escrita de `pipelines` e `stages`: de
  `papel_na_conta(...) = 'admin'` para `is_member_of(...)`. Leitura já é por
  membro; não muda.
- Sem coluna nova, sem RPC nova: criação de pipeline + etapas é feita pelo
  store com inserts diretos (mesma camada que já escreve stages hoje).
- Conferir contra o checklist de guardas silenciosas do Supabase antes de
  finalizar (grants, search_path, security definer, revokes).

Invariantes que o store garante na criação (o banco já ajuda com
`stages_ordem_por_pipeline`):

- Etapas abertas com `ordem` 1..N na ordem do modal; Ganho em N+1, Perdido em
  N+2.
- Exclusão: apagar a pipeline cascateia nas stages (`on delete cascade` já
  existe); o store recusa se `is_default` ou se existir lead com
  `pipeline_id` da pipeline.

## Store (`CrmStore`)

Métodos novos, implementados em `supabase.ts` e `memory.ts` (dublê de teste):

- `listarPipelines()` → `Pipeline[]` (padrão primeiro, depois por criação).
- `pipelinePorId(id)` → `{ pipeline, etapas }` — mesma forma de retorno de
  `pipelinePadrao()`; `pipeline_nao_encontrado` se não existir/não for da
  conta.
- `criarPipeline(nome, etapasAbertas: string[])` → id novo; monta as etapas
  com Ganho/Perdido ao final.
- `renomearPipeline(id, nome)`.
- `excluirPipeline(id)` → falha com `pipeline_padrao_nao_exclui` ou
  `pipeline_com_leads` conforme o caso.
- `FiltroLeads` ganha `pipelineId?: string | null` e `listarLeads` filtra por
  ele (o quadro hoje mostraria colunas certas por acidente — os stageIds não
  batem — mas o filtro explícito é correção e desempenho).

`pipelinePadrao()` permanece intacto: métricas, disparo, config, scripts e
ingestão continuam usando.

## Telas afetadas

- **`/funil` (page.tsx):** resolve a pipeline ativa pela URL, carrega
  `listarPipelines()` para a barra lateral, passa as etapas da pipeline ativa
  ao quadro e filtra leads por `pipelineId`.
- **Novo lead (acoes.ts):** `criarLeadAction` recebe a pipeline ativa (campo
  no form) e cria o lead na primeira etapa aberta **dela**, não da padrão.
  Pipeline inválida no form falha com `pipeline_nao_encontrada` (sem
  fallback silencioso: id inválido aqui só acontece se a pipeline foi
  excluída no meio, e criar o lead noutra pipeline seria surpresa pior que o
  erro).
- **Ficha do lead (`/leads/[id]`):** correção necessária — troca
  `pipelinePadrao()` por `pipelinePorId(lead.pipelineId)`, senão lead de
  pipeline nova mostra etapas erradas na ficha. O link de voltar aponta para
  `/funil?pipeline=<id>` quando a pipeline não é a padrão.

## Erros (códigos novos)

`pipeline_nao_encontrada`, `pipeline_padrao_nao_exclui`,
`pipeline_com_leads`, `nome_obrigatorio`, `etapas_minimo_uma` — mapeados para
frases em pt-BR no padrão das telas existentes (dicionário local, nunca erro
cru na tela).

## Testes

- Unidade (store memory + supabase via contrato existente): criação monta
  Ganho/Perdido ao final; exclusão recusa padrão e pipeline com leads;
  `listarLeads` respeita `pipelineId`; `pipelinePorId` de outra conta falha.
- Componente: modal de criação (mínimo 1 etapa, nomes vazios, reordenar);
  barra lateral (padrão primeiro, ativa destacada, links certos); novo lead
  envia a pipeline ativa.
- E2E: criar pipeline pela barra, ver o funil trocar de colunas, criar lead
  nela, voltar à padrão e confirmar que o lead não aparece lá; ficha do lead
  da pipeline nova mostra as etapas dela.

## Preview antes do merge

Todo o trabalho em branch `plano-14-pipelines`. Antes de qualquer merge:
demonstração local (`npm run dev`) e, se Pedro quiser, push da branch para
gerar preview deployment no Vercel com URL própria. Merge só depois do OK.
