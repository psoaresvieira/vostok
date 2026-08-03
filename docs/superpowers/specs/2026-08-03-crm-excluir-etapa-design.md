# Excluir etapa do funil — design

**Data:** 2026-08-03
**Estado:** aprovado no brainstorming, pronto para virar plano
**Irmãs:** `2026-08-01-crm-rastreamento-metricas-design.md` (define as duas RPCs que este design altera)

## 1. O problema

A tela `/config` deixa criar, renomear e reordenar etapas do funil, mas **não deixa excluir**. Uma etapa criada por engano fica para sempre.

Acrescentar exclusão parece um botão. Não é: quatro chaves estrangeiras apontam para `stages`, todas `NO ACTION`, e uma delas sustenta o cálculo de `/metricas`.

| Referência | O que quebra se a etapa sumir |
|---|---|
| `leads.stage_id` | lead sem etapa |
| `stage_history.stage_origem` / `stage_destino` | o funil de `/metricas` |
| `lead_tags.stage_id_no_momento` | o ranking de etiquetas de `/metricas` |

## 2. Decisões do brainstorming

| Pergunta | Escolha |
|---|---|
| Lead ainda na etapa | **Bloqueia**, dizendo quantos leads estão lá |
| Última etapa de um tipo (`aberta`/`ganho`/`perdido`) | **Bloqueia**, dizendo qual tipo |
| Etapa com histórico | **Exclui de verdade**, preservando o histórico por snapshot |
| Reordenação sem transação (dívida do backlog) | **Consertar junto** — RPC plpgsql |
| Escopo da tela | Excluir com confirmação + feedback de "salvo" no renomear |

A alternativa barata — manter a linha marcada como excluída e escondê-la de toda a interface — foi apresentada com o custo comparado e **recusada deliberadamente**: a etapa deve sair do banco.

## 3. Por que o snapshot é obrigatório

As duas RPCs de `/metricas` **não guardam a profundidade do lead**. Elas recalculam a cada leitura, fazendo `join` em `stages` para ler `ordem` e `tipo`. Excluir a etapa não muda o futuro — reescreve o passado, em silêncio.

**`metricas_funil`** (`0014_metricas.sql:64-78`) faz `max(s.ordem)` varrendo `stages` onde `s.tipo = 'aberta'` e a etapa aparece no `stage_id` atual ou no histórico do lead. Etapa apagada some do `max`, e a profundidade alcançada pelo lead **cai retroativamente**.

**`metricas_etiquetas`** (`0014_metricas.sql:105-113`) faz `join public.stages s on s.id = lt.stage_id_no_momento` — **inner join**. Com a etapa apagada, a linha inteira desaparece e a etiqueta some do ranking.

Nenhum dos dois dá erro. Nenhum aparece em log. Um teste que conta linhas não vê. É o defeito nº 5 da lista de guardas silenciosas do projeto: *a subconsulta colapsa para zero em vez de dar erro*.

**Consequência de desenho:** o histórico não pode continuar dependendo de `stages` existir. A fonte de verdade do passado passa a ser o snapshot; a chave estrangeira vira um atalho para a etapa viva.

## 4. Banco — migration `0016`

### 4.1 Colunas de snapshot

Em `stage_history`: `stage_origem_nome`, `stage_origem_ordem`, `stage_origem_tipo` (anuláveis, como `stage_origem` já é) e `stage_destino_nome`, `stage_destino_ordem`, `stage_destino_tipo` (**not null**).

Em `lead_tags`: `stage_nome_no_momento`, `stage_ordem_no_momento`, `stage_tipo_no_momento` (**not null**).

Preenchidos **retroativamente por backfill** a partir de `stages`, na própria migration, e daí em diante **por trigger `before insert`** que deriva `nome`/`ordem`/`tipo` da etapa referenciada.

**Por que trigger, e não a aplicação.** As duas tabelas são escritas **direto pelo cliente**: `lead_tags` tem policy de insert para `authenticated` (`0003_leads.sql:134`), e `stage_history` também aceita insert de `authenticated` — o projeto já registrou que `move_lead_stage` não é comprovadamente o único escritor. Se o snapshot dependesse de quem escreve, bastaria um caminho esquecido para nascer linha com `nome` de uma etapa e `id` de outra, e **nada detectaria** — o snapshot é justamente o dado que ninguém confere depois. O trigger torna a consistência entre FK e snapshot definicional em vez de convencional.

Isto introduz **o primeiro trigger deste repositório**, que até aqui não tem nenhum (nem de `atualizado_em`). É desvio consciente de convenção, e a razão é a de cima: aqui a alternativa não é "a aplicação escreve", é "algum caminho não escreve e ninguém percebe".

A invariante que hoje o banco garante por `not null` na FK passa a ser garantida pelo `not null` no snapshot: **toda linha de histórico sabe de qual etapa fala, exista ela ou não.**

### 4.2 Relaxamento das FKs

`stage_history.stage_destino` e `lead_tags.stage_id_no_momento` deixam de ser `not null` e ganham `on delete set null`. **`nulo` passa a significar "essa etapa foi excluída"** — não "dado faltando".

`leads.stage_id` **continua `not null`**: a guarda de leads impede que a exclusão chegue lá.

### 4.3 As duas RPCs de métricas

Deixam de fazer `join` em `stages` e passam a ler o snapshot:

- **`metricas_funil`**: o `max(ordem)` passa a ser sobre a união de duas fontes — o **snapshot** de `stage_origem` e `stage_destino` do histórico do lead, e a **etapa atual** (`leads.stage_id`), esta ainda lida de `stages`, porque a guarda de leads garante que ela existe. Filtra por `tipo = 'aberta'` do snapshot no primeiro caso e de `stages` no segundo. O filtro por tipo não é detalhe: Ganho e Perdido têm ordem maior que toda etapa aberta, e sem ele todo lead perdido sairia com a profundidade máxima.
- **`metricas_etiquetas`**: lê `lt.stage_ordem_no_momento` direto, sem `join` em `stages`. O `join` some, e com ele o modo de falha.

O comentário atual de `metricas_funil` afirma que a união "é completa sem backfill nenhum". **Depois desta mudança isso deixa de ser verdade** — o backfill passa a ser pré-requisito, e o comentário tem que ser corrigido junto, senão fica mentindo para quem ler depois.

### 4.4 Duas RPCs novas, ambas `security invoker`

**`excluir_etapa(p_stage_id uuid)`** — avalia as três guardas e apaga, numa transação.

**`reordenar_etapas(p_ids_na_ordem uuid[])`** — paga a dívida do backlog: hoje a reordenação grava etapa por etapa, e falha no meio ou concorrência corrompe a ordem de forma irrecuperável.

`security invoker` é deliberado e é o **inverso** do hábito. Aqui `definer` desligaria a proteção: a RLS de `stages` é o que impede um membro de apagar etapa de outra conta, e sob `definer` ela não seria avaliada, porque as tabelas são de `postgres` e nenhuma migration usa `force row level security`. Dois testes seguram isso: `prosecdef = false` em `pg_proc`, e um teste de discriminação chamando a mesma função com os mesmos argumentos por dois papéis diferentes.

**As guardas vivem dentro da RPC, não na tela.** A função é alcançável direto pelo PostgREST; guarda que mora só na interface não é guarda.

## 5. Camadas acima

`CrmStore` ganha `excluirEtapa(etapaId): Promise<Resultado<void>>`, com códigos próprios: `etapa_tem_leads`, `ultima_etapa_do_tipo`, `etapa_nao_encontrada`. `reordenarEtapasAction` passa a chamar a RPC nova em vez de gravar etapa por etapa.

Todos os códigos são traduzidos no mapa de `config/erros.ts` — nenhuma mensagem crua do PostgREST na tela — e toda ação chamada do componente cliente continua passando por `chamarAcao`.

## 6. Interface

Cada etapa ganha **Excluir**, com diálogo que diz o que vai acontecer **antes** de confirmar: quantos leads já passaram por ali e que o histórico será preservado. Quando uma guarda recusa, a mensagem diz o motivo e o número — "Mova os 12 leads desta etapa antes de excluí-la", "Esta é a última etapa do tipo ganho".

O renomear, que hoje salva no `onBlur` sem nenhum sinal, passa a **confirmar visualmente que gravou**.

O resto da tela fica como está: reordenar continua por setas, sem drag-and-drop.

## 7. Testes

**Integração contra Postgres real:** as três guardas, cada uma com o caso que passa e o que recusa; o isolamento entre contas nas duas RPCs novas; e `prosecdef = false`.

**O teste que sustenta a parte cara** — criar etapa, mover leads por ela, medir `/metricas`, excluir a etapa, medir de novo e **exigir os mesmos números**. Sem ele, o snapshot não tem garantia nenhuma e o trabalho caro fica sem prova.

**O backfill precisa de teste próprio.** Ele roda uma vez sobre dados existentes; se errar, erra em silêncio.

**O trigger precisa de teste que insira direto na tabela**, sem passar por `move_lead_stage` — é exatamente o caminho que motivou o trigger, e testá-lo só pela RPC provaria a coisa errada.

**Componente:** o diálogo e as mensagens de recusa.

Todo teste novo com RED demonstrado. Nenhuma contagem de teste neste documento.

## 8. Riscos aceitos

1. **Relaxar dois `not null`** enfraquece uma invariante que hoje o banco garante. A compensação é o snapshot ser `not null` — a informação continua obrigatória, só muda de coluna.
2. **O backfill é irrepetível** e falha em silêncio se estiver errado. Daí o teste próprio.
3. **Primeiro trigger do repositório** (§4.1). Ganha-se consistência garantida; perde-se a propriedade de que toda escrita neste banco é visível lendo a aplicação. Registrado para quem estranhar depois.
4. **`ordem` do snapshot e `ordem` das etapas vivas divergem depois de uma reordenação.** Isto **já é verdade hoje** — reordenar etapas muda o que o funil do passado significa —, mas o snapshot torna a divergência permanente e explícita. Não é regressão; é uma limitação que passa a estar escrita. Se um dia doer, o conserto é versionar o pipeline, e é design próprio.

## 9. Critério de aceite

Você abre `/config`, cria uma etapa por engano e a exclui — ela some. Tenta excluir uma etapa com leads dentro e o sistema recusa dizendo quantos são. Tenta excluir a última etapa do tipo ganho e ele recusa dizendo o tipo. Exclui uma etapa antiga, por onde leads já passaram, e **os números de `/metricas` do mês passado continuam exatamente os mesmos**. Renomeia uma etapa e vê que gravou. Reordena e a ordem nunca fica pela metade.
