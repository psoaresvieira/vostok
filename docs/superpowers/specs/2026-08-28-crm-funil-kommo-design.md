# Funil estilo Kommo — card compacto, drawer do lead e mover entre pipelines

**Data:** 2026-08-28 · **Estado:** aprovado pelo Pedro em conversa (referência: três capturas do Kommo) · **Escopo:** três mudanças no funil do Vostok, entregues juntas porque compartilham o cabeçalho do drawer.

## Contexto

Hoje (`src/app/(app)/funil/`): o card (`cartao.tsx`, `rounded-2xl p-3`, ~92px) mostra nome, valor, tempo na etapa (vermelho ≥72h), responsável e etiquetas; o clique navega para a página `/leads/[id]`; a etapa muda por um `<select>` na ficha ou por drag-and-drop no quadro, sempre via `moverEtapaAction` → RPC `move_lead_stage` (0004), que só verifica que a etapa de destino é da mesma **conta** — não da mesma pipeline — e nunca toca `leads.pipeline_id`. Não existe mover um lead para outra pipeline.

Decisões do Pedro:

1. **Card** no formato Kommo: nome + data de criação à direita + bolinha de status (vermelha quando parado ≥72h) / telefone + responsável / etiquetas. O valor sai do card.
2. **Drawer lateral** sobre o quadro ao clicar no card (não página), com abas **Principal · Tarefas · Histórico**.
3. **Mover entre pipelines** por um seletor no cabeçalho do drawer (pipeline atual expandida com as etapas coloridas; outras pipelines colapsadas).
4. Arquitetura **A**: drawer aberto por search param `?lead=<id>` na rota `/funil`, renderizado no servidor.

## Parte 1 — Card

`LeadDoFunil` (`src/lib/domain/tipos.ts`) ganha `telefone: string | null` (formatado pela `formatarTelefone` na tela) e `criadoEm: Date`; perde nada (o `valorCents` segue no tipo porque a soma da coluna o usa; o card apenas não o exibe). A query de `leadsDoFunil` em `src/lib/data/supabase.ts` seleciona as duas colunas a mais; o store em memória acompanha.

Layout (`cartao.tsx`, `p-2.5`, alvo ~70px):

- Linha 1: nome (botão que abre o drawer — ver Parte 2), à direita `criadoEm` em `dd/MM/yyyy` (fuso `America/Sao_Paulo`, mesmo `FUSO_PADRAO` do `/admin`) e uma bolinha de 8px: `bg-destructive` quando `horasNaEtapa ≥ 72` com `title`/`aria-label` "Parado há N dias", `bg-muted-foreground/40` caso contrário. A regra do parado (`horasNaEtapa`, 72h) não muda.
- Linha 2: telefone formatado à esquerda (ou "sem telefone"), responsável à direita em `text-muted-foreground` (ou "sem responsável"), ambos truncáveis.
- Linha 3: etiquetas (`Selo tom="primario"`), como hoje.

`quadro.tsx`: `containIntrinsicSize` passa para `'auto 72px'`. O drag-and-drop e o `DragOverlay` não mudam.

## Parte 2 — Drawer do lead

### Abertura e URL

`/funil?…&lead=<id>`. `page.tsx` do funil, quando `params.lead` existe, busca o lead (`store.buscarLead`), as tarefas, as etapas de **todas** as pipelines da conta e os dados que a ficha já busca hoje, e renderiza `<DrawerLead>` ao lado do `<Quadro>`. Lead inexistente ou de outra conta → renderiza o funil sem drawer e com aviso "Esse lead não existe mais" (mesma mensagem de `nao_encontrado` do funil/erros.ts), sem 404.

Clique no card: `router.push(hrefComParam({ lead: id }), { scroll: false })` — o helper de serialização de params que `page.tsx` já usa (`hrefDoItem` em `barra-pipelines.tsx`) é promovido a `src/app/(app)/funil/params.ts` e reutilizado. Fechar (X, Escape, clique no backdrop): `router.push(hrefSemParam('lead'), { scroll: false })`. O botão "voltar" do navegador fecha o drawer porque cada abertura é uma entrada de histórico.

`/leads/[id]` deixa de renderizar a ficha e vira `redirect('/funil?pipeline=<lead.pipelineId>&lead=<id>')` (lead inexistente → `/funil`). Todos os links existentes (sino, tarefas, timeline, notificações) continuam válidos. Os componentes da ficha (`timeline.tsx`, `etiquetas.tsx`, `nota.tsx`, `acoes-lead.tsx`, `tarefas.tsx`, `bloco-scripts.tsx`) **mudam de pasta** para `src/app/(app)/funil/drawer/` e passam a ser renderizados pelo drawer; os testes acompanham.

### Estrutura

Painel fixo à direita (`w-[min(560px,100vw)]`, `h-dvh`, rolagem interna, backdrop `bg-foreground/30`), `role="dialog"` `aria-modal="true"` `aria-labelledby` no nome, foco inicial no botão de fechar, Escape fecha, foco devolvido ao card que abriu (padrão do `Modal` existente em `src/components/ui/modal.tsx`; o drawer é um novo primitivo `src/components/ui/drawer.tsx` com o mesmo contrato de portal/escape/foco, não uma adaptação do Modal).

Cabeçalho (fixo, fundo `bg-primary` texto claro como na captura):

- Linha 1: botão fechar (chevron) + nome do lead + valor formatado à direita (o valor sai do card e mora aqui).
- Linha 2: etiquetas atuais como `Selo` + botão "+" que abre o `EditorEtiquetas`.
- Linha 3: nome da pipeline (muted) e, embaixo, **nome da etapa + "(há N dias)"** — este bloco é o **gatilho do seletor** (Parte 3) — com um chevron.
- Linha 4: **barra de progresso** de etapas: uma faixa por etapa da pipeline atual, na ordem, com a cor da etapa; as faixas até a atual inclusive ficam cheias, as seguintes em 30% de opacidade. Etapas `ganho`/`perdido` não entram na barra (são desfechos, não progresso).

Abas (`role="tablist"`, seta esquerda/direita alterna, aba ativa na URL não — estado local; padrão inicial "Principal"):

- **Principal**: `<dl>` Responsável (com o `<select>` de `acoes-lead.tsx`, sem o de etapa — a etapa agora muda pelo cabeçalho), Venda (valor), Telefone (link `tel:` + botão WhatsApp de `bloco-scripts.tsx`), Email, Empresa, Origem; em seguida o `BlocoScripts` (envio de template) como está.
- **Tarefas**: `PainelTarefas` como está.
- **Histórico**: `Timeline` + `FormularioNota` como estão.

### Cores das etapas

Sem migration: paleta fixa de 6 tons por **posição** (`ordem`) da etapa dentro da pipeline, em `src/lib/domain/etapa-cor.ts` — `corDaEtapa(ordem: number, tipo: StageTipo): { classeFundo: string; classeTexto: string }`. `ganho` → verde fixo, `perdido` → cinza fixo, abertas → paleta cíclica (azul, amarelo, laranja, verde-água, roxo, rosa) na ordem em que a captura do Kommo as mostra. As classes são literais Tailwind completas (não interpoladas) para o purge não as perder; um teste pina o mapeamento.

## Parte 3 — Mover entre pipelines

### Seletor

Clicar no bloco de etapa do cabeçalho abre um popover (`role="listbox"` agrupado) ancorado abaixo dele:

- Grupo da pipeline atual, expandido: uma linha por etapa na `ordem`, fundo na cor da etapa, ✓ na atual, `ganho` e `perdido` no fim ("Ganho", "Perdido").
- Um cabeçalho por outra pipeline da conta, colapsado; clicar expande as etapas dela (mesmo formato) e colapsa as demais.
- Escolher uma etapa: se for da pipeline atual, segue o fluxo de hoje (`ModalMovimento` → `moverEtapaAction`); se for de outra pipeline, abre o mesmo `ModalMovimento` (etiquetas + motivo de perda quando `perdido`) e confirma via a action nova `moverParaPipelineAction`.
- Escolher a etapa atual: fecha o popover, nada acontece.

Depois de mover para outra pipeline, o drawer continua aberto com o lead já na pipeline nova, e o quadro atrás passa a mostrar **a pipeline nova** (`router.push` com `pipeline=<nova>&lead=<id>`), porque o card sumiu da pipeline anterior e o usuário precisa vê-lo onde ele foi parar.

### Banco — migration `0031_mover_lead_pipeline.sql`

1. **RPC nova** `mover_lead_pipeline(p_lead_id uuid, p_stage_destino uuid, p_loss_reason_id uuid default null) returns void`, `security invoker`, `set search_path = public`, grant de EXECUTE a `authenticated` (e entrada no mapa do teste da 0024 que enumera `pg_proc`). Corpo, na ordem: `select … for update` do lead (`lead_nao_encontrado`); etapa de destino com join em `pipelines` da mesma conta (`etapa_invalida`); se `s.pipeline_id = v_lead.pipeline_id` → `raise exception 'mesma_pipeline'` (o chamador certo é `move_lead_stage`); validação de `perdido`/motivo idêntica à 0004; `update leads set pipeline_id = s.pipeline_id, stage_id = …, status derivado, loss_reason_id, entrou_na_etapa_em = now(), atualizado_em = now()`; `insert into stage_history` (origem/destino, `movido_por`); `insert into lead_events` com `tipo = 'pipeline_alterada'` e `payload = {de_pipeline, para_pipeline, de, para, loss_reason_id}`.
2. **Emenda em `move_lead_stage`**: o `select` da etapa de destino ganha `and s.pipeline_id = v_lead.pipeline_id`; etapa de outra pipeline passa a cair em `etapa_invalida`. Fecha o buraco que hoje deixaria `pipeline_id`/`stage_id` inconsistentes. Nada mais muda na função.
3. Teste de integração `tests/integration/0031_mover_lead_pipeline.test.ts`: move entre pipelines e confere `pipeline_id`, `stage_id`, `status`, `entrou_na_etapa_em`, a linha de `stage_history` e o evento `pipeline_alterada`; `mesma_pipeline`; `etapa_invalida` para etapa de outra conta; `perdido` sem motivo → `motivo_perda_obrigatorio`; **`move_lead_stage` com etapa de outra pipeline → `etapa_invalida`** (o caso que hoje passa e não deveria); RLS: vendedor não move lead que não vê (`lead_nao_encontrado`).

### Aplicação

- `CrmStore.moverParaPipeline(leadId, stageDestino, lossReasonId?)` (`store.ts`, `supabase.ts` via `rpc('mover_lead_pipeline')`, `memory.ts` espelhando as guardas: `mesma_pipeline`, `etapa_invalida`).
- `moverParaPipelineAction(leadId, stageDestino, lossReasonId, etiquetas)` em `funil/acoes.ts`, mesma forma de `moverEtapaAction` (etiquetas aplicadas ANTES do movimento para o snapshot `stage_id_no_momento` registrar a etapa de origem; `revalidatePath('/funil')`).
- `timeline.tsx` ganha o caso `pipeline_alterada`: "Movido de *Pipeline A · Etapa X* para *Pipeline B · Etapa Y*" (nomes resolvidos pelo mapa de etapas de todas as pipelines que o drawer já recebe; id sem nome → "etapa removida", como o caso `etapa_alterada` faz hoje).
- `funil/erros.ts`: `mesma_pipeline: 'Esse lead já está nessa pipeline. Escolha uma etapa.'`.

## Testes

- Unitários (vitest + Testing Library, `environment: jsdom` onde há DOM): `cartao.test.tsx` (data formatada no fuso, bolinha vermelha só ≥72h — provado por mutação do limiar, telefone/responsável com fallback), `etapa-cor.test.ts` (mapeamento pinado), `drawer.test.tsx` (abre/fecha por URL, Escape, foco devolvido, abas por teclado), `seletor-etapa.test.tsx` (pipeline atual expandida, outras colapsadas, escolher etapa da atual chama `moverEtapaAction`, de outra chama `moverParaPipelineAction`, atual não chama nada — asserção sobre um store falso, não spy de módulo quando houver alternativa), `params.test.ts` (serialização com/sem `lead`), `timeline.test.tsx` (caso `pipeline_alterada`), `memory.ts` com as guardas novas.
- Integração: `0031_mover_lead_pipeline.test.ts` acima + atualização do mapa da 0024.
- E2E (`tests/e2e/funil.spec.ts`): clicar num card abre o drawer com a URL `?lead=`; voltar do navegador fecha; mover para outra pipeline pelo seletor e ver o card na pipeline nova. Specs existentes que navegam para `/leads/[id]` passam a esperar o redirect.

## Fora de escopo

Cores de etapa configuráveis pelo usuário (migration futura), abas "Estatísticas"/"Mídia" do Kommo, drag-and-drop entre pipelines, coluna "Incoming leads" (caixa de entrada do WhatsApp — depende do sub-projeto de resposta do WhatsApp), redesenho da barra de pipelines à esquerda.
