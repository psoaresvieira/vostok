# Spec — CRM: Fundação + Núcleo do Funil (sub-projeto 1)

Data: 2026-07-27
Origem: `Obsidian Vault/CRM/v.0.md` (especificação do produto completo)
Status: aprovado no brainstorming, pronto para `writing-plans`

---

## 1. Contexto e recorte

O produto completo é um CRM para negócios que rodam tráfego pago, com ingestão nativa de leads do Meta Ads e Google Ads, aba de Scripts de Venda, etiquetas livres e uma aba de Métricas que quantifica *por que* o lead não fecha. A spec de produto está em `v.0.md` no Obsidian.

O MVP descrito lá são quatro subsistemas independentes. Construir tudo sob um único plano produziria um plano irrevisável, então o trabalho foi decomposto em quatro sub-projetos, cada um com seu próprio ciclo spec → plano → implementação:

1. **Fundação + núcleo do funil** ← *este documento*
2. Ingestão automática (webhooks Meta e Google, dedup, notificações Realtime)
3. Métricas (conversão entre etapas, distribuição de etiquetas por etapa, conversão por canal)
4. Scripts de Venda + Tarefas

A ordem segue o risco: (1) é pré-requisito de tudo; (2) precede (3) porque métrica por canal sem dado de canal é chute; (4) fica por último por ser CRUD de baixo risco técnico, não por ser menos importante como diferencial de venda.

**Escopo deste sub-projeto:** um CRM multi-tenant utilizável manualmente — contas, usuários com papéis, pipeline com etapas, cadastro de lead, Kanban com drag-and-drop, etiquetas livres com snapshot de etapa, histórico de etapas, motivo de perda obrigatório e timeline do lead.

## 2. Decisões tomadas no brainstorming

| Decisão | Escolha | Razão |
|---|---|---|
| Alvo do produto | SaaS multi-tenant desde o dia 1 | Evita remodelagem de banco quando a venda acontecer |
| Stack de dados/auth | Supabase (Auth + Postgres + RLS + Realtime) | RLS põe o isolamento no banco; Realtime já resolve a notificação in-app do sub-projeto 2; stack já conhecida do `gestor-trafego` |
| Card do funil | O Lead é o card (modelo Kommo) | Igual à operação atual da SE7E; schema mais simples; `stage_history` já aponta para `lead_id` na spec de produto |
| Meta Lead Ads | App e Business Verification já existem | Driver real é o padrão em produção; interface de driver mantida só para os testes não baterem na Graph API |
| Mobile | Desktop neste ciclo, mobile no próximo | Kanban desktop é a tela que vende o produto em demonstração |

### Correções aplicadas sobre `v.0.md`

- A seção 2.8 da spec de produto tem **dois itens "(c)"** descrevendo a mesma métrica (conversão por canal / por origem). São uma só. Pertence ao sub-projeto 3.
- A spec pede "deduplicação automática por telefone/email". Com o card sendo o Lead, a mesma pessoa vira legitimamente um lead novo em recompra ou segundo serviço — logo **dedup não pode ser constraint única**. Ver §4.
- A entidade `Deal` da spec de produto é absorvida pelo Lead (`valor_cents`, `loss_reason_id`, `status`).

## 3. Modelo de dados

```
accounts        id, nome, criado_em
profiles        id (= auth.users.id), nome, email
memberships     account_id, user_id, papel (admin|gestor|vendedor)   PK (account_id, user_id)

pipelines       id, account_id, nome, is_default, criado_em
stages          id, pipeline_id, nome, ordem, tipo (aberta|ganho|perdido), sla_horas?
loss_reasons    id, account_id, nome, ativo

leads           id, account_id, nome, telefone, telefone_e164, email, email_norm,
                empresa, origem (meta|google|manual|indicacao|organico),
                campanha_origem?, formulario_origem?,
                pipeline_id, stage_id, responsavel_id?,
                status (aberto|ganho|perdido), valor_cents?, loss_reason_id?,
                criado_em, atualizado_em

tags            id, account_id, nome, criado_por, criado_em   UNIQUE (account_id, lower(nome))
lead_tags       lead_id, tag_id, stage_id_no_momento, criado_por, criado_em
stage_history   id, lead_id, stage_origem?, stage_destino, movido_por, criado_em
lead_events     id, lead_id, tipo, payload jsonb, ator_id, criado_em   (append-only)
```

Convenções: `timestamptz` em UTC; dinheiro em centavos (`integer`), moeda BRL implícita por conta; ids `uuid`.

Campos que existem agora mas só são usados em ciclos posteriores, porque custam zero hoje e evitariam migration em tabela cheia depois: `origem`, `campanha_origem`, `formulario_origem`, `stages.sla_horas`, `pipelines` (múltiplos).

### Timeline vs métricas

`stage_history` guarda a mudança de etapa em colunas tipadas — é a base de cálculo da conversão do sub-projeto 3, e métrica lendo `jsonb` é lenta e frágil. `lead_events` é a narrativa legível da ficha do lead (nota, troca de etapa, etiqueta aplicada, troca de responsável). Uma troca de etapa escreve nas duas, dentro da mesma função Postgres (§5), de modo que não existe caminho de código em que divirjam.

### Etiquetas

`lead_tags.stage_id_no_momento` é o snapshot exigido pela spec de produto: sem ele, a métrica "distribuição de etiquetas por etapa" passa a mentir assim que o lead avança. `tags` é única por conta e case-insensitive, o que dá autocomplete sem transformar "Preço alto" e "preço alto" em duas etiquetas distintas. Um lead pode ter várias etiquetas.

## 4. Isolamento multi-tenant (RLS)

`account_id` em toda tabela de domínio, RLS habilitada em todas.

As policies chamam uma função `is_member_of(account_id uuid)` marcada `STABLE SECURITY DEFINER`, que consulta `memberships`. `SECURITY DEFINER` é obrigatório: sem ele a policy consulta uma tabela que também tem policy, e a avaliação entra em recursão.

Regras:

- Todo acesso exige `is_member_of(account_id)`.
- Papel `vendedor`: em `leads` e nas tabelas dependentes, só enxerga registros com `responsavel_id = auth.uid()`.
- Papéis `admin` e `gestor`: enxergam a conta inteira.
- `lead_events` e `stage_history` são insert-only; não há policy de update ou delete.

A restrição de visibilidade vive no banco, não no `WHERE` da aplicação.

### Deduplicação

Colunas normalizadas `telefone_e164` e `email_norm`, com índice comum (**não** único).

- **Cadastro manual:** ao salvar, o sistema procura leads com o mesmo telefone/email na conta e exibe os encontrados com seu status, deixando o usuário decidir entre continuar ou abrir o lead existente. Nunca bloqueia.
- **Ingestão automática (sub-projeto 2, registrado aqui para o schema não mudar):** é duplicata apenas se o lead existente estiver com `status = aberto`. Lead fechado + contato novo é negociação nova.

## 5. Arquitetura da aplicação

Repo: `C:\Users\Pedro\projects\crm`. Next.js 15 (App Router) + TypeScript + Supabase. Deploy Vercel.

```
src/
  app/
    (auth)/login, /signup
    (app)/funil            Kanban
    (app)/leads/[id]       ficha do lead + timeline
    (app)/config           pipelines, etapas, motivos de perda, usuários
  lib/
    domain/    regras puras + schemas Zod — sem IO, sem Supabase
    data/      port CrmStore + SupabaseCrmStore + InMemoryCrmStore
    supabase/  clients (server com cookies, browser)
supabase/migrations/
```

Mesma disciplina do `gestor-trafego`: o domínio é código puro e testável sem banco, e todo acesso a dados passa pelo port `CrmStore`. A UI nunca fala com Supabase diretamente.

**Chaves.** Apenas a chave `anon`, sempre com a sessão do usuário — quem filtra é a RLS. `service_role` não aparece neste sub-projeto; ela entra no sub-projeto 2, isolada nos handlers de webhook. Se a chave privilegiada não existe no código da UI, nenhum descuido futuro consegue furar o isolamento por ali.

**Mutações via Server Actions**, com uma exceção deliberada.

### `move_lead_stage` — função Postgres

Mover lead de etapa é uma função Postgres chamada por RPC:

```
move_lead_stage(p_lead_id uuid, p_stage_destino uuid, p_loss_reason_id uuid default null)
```

Numa única transação: atualiza `leads` (`stage_id`, `status`, `loss_reason_id`, `atualizado_em`), insere em `stage_history` e insere em `lead_events`. **Rejeita** destino com `tipo = 'perdido'` sem `loss_reason_id` válido da mesma conta.

O motivo de perda obrigatório é a única regra cuja violação corrompe métrica de forma silenciosa e irreversível — um lead perdido sem motivo não tem como ser corrigido depois, porque ninguém lembra. Por isso mora no banco, onde nenhum chamador consegue esquecer dela, e não numa validação de formulário.

### Drag-and-drop

Atualização otimista: o card move imediatamente e, se o RPC falhar, volta à posição original com toast de erro. Kanban que trava a cada arrasto é abandonado pelo vendedor.

## 6. Telas

**Funil (Kanban).** Colunas = etapas do pipeline padrão da conta. Card mostra nome, valor, etiquetas, responsável e **tempo parado na etapa** (esse contador é o que provoca ação, e deixa o terreno pronto para o SLA da fase 2). Filtros por responsável, origem e período; busca por nome/telefone. O filtro de responsável não aparece para vendedor, porque a RLS já reduziu o board aos leads dele.

**Ficha do lead.** Dados, campo de etiquetas com autocomplete das já usadas na conta e criação livre ao digitar, timeline lida de `lead_events`, e ações: mover etapa, trocar responsável, adicionar nota.

**Momento da etiqueta.** Ao arrastar o card para outra etapa abre um modal leve pedindo etiquetas (opcional); quando o destino é Perdido, o mesmo modal exige o motivo. É o instante de maior sinal e menor atrito — etiqueta que depende de o vendedor lembrar de abrir a ficha depois não é preenchida, e a aba de Métricas nasce vazia.

**Cadastro rápido** em modal, com o aviso de possível duplicata de §4.

**Config.** Pipelines e etapas (com reordenação), motivos de perda, usuários e papéis.

**Seed de conta nova.** Pipeline padrão (Novo lead → Contato feito → Qualificação → Proposta → Fechamento, mais Ganho e Perdido) e motivos de perda padrão. Conta que abre vazia exigindo configuração antes de qualquer uso é onde o early user desiste.

**Mobile.** Fora deste ciclo. O app deve permanecer navegável em tela pequena, mas o Kanban é otimizado para desktop.

## 7. Testes

**Unitários (Vitest) sobre `domain` + `InMemoryCrmStore`:** transições de etapa, normalização de telefone para E.164, normalização de email, normalização de etiqueta case-insensitive, snapshot de etapa na aplicação da tag, exigência de motivo na perda, cálculo de tempo parado na etapa.

**Integração contra Supabase local (`supabase start`) com as migrations aplicadas.** RLS não é testável com mock: é policy em Postgres, e só Postgres diz se funciona. Casos obrigatórios, nomeados:

- usuário da conta A não lê nenhum registro da conta B;
- vendedor não lê lead de outro vendedor da mesma conta;
- gestor e admin leem a conta inteira;
- `move_lead_stage` rejeita destino "perdido" sem motivo;
- `move_lead_stage` rejeita `loss_reason_id` de outra conta;
- uma mudança de etapa escreve `leads`, `stage_history` e `lead_events`, ou não escreve nada;
- `lead_events` e `stage_history` não aceitam update nem delete.

**Smoke E2E (Playwright), um caminho só:** criar lead → arrastar pelo funil → perder com motivo → conferir a timeline.

## 8. Erros

Server Actions devolvem resultado tipado (`ok` / `erro`), sem exception vazando para a UI.

Detalhe que vira bug confuso se ignorado: com RLS ativa, ler um registro sem permissão retorna **zero linhas**, não erro de acesso. O código trata isso como "não encontrado" e nunca expõe a existência de dado de outra conta.

## 9. Fora de escopo neste sub-projeto

Webhooks Meta e Google; notificações (in-app, email, push); aba de Métricas; Scripts de Venda; Tarefas, calendário e lembretes; automações por gatilho; alertas de SLA; WhatsApp Cloud API; billing e onboarding self-service; CPL/CPA; versionamento de scripts; múltiplos pipelines na UI (o schema suporta, a UI opera um por conta).

## 10. Pronto quando

Você cria uma conta, convida um vendedor, ele entra e vê apenas os leads dele, cadastra um lead, arrasta pelo funil, etiqueta na qualificação, perde um lead com motivo obrigatório, e a timeline da ficha conta essa história inteira — com a suíte de testes verde e as policies de RLS verificadas contra Postgres real.
