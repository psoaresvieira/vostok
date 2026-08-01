# Spec — CRM: Rastreamento de origem + Métricas (sub-projeto 3)

Data: 2026-08-01
Origem: `Obsidian Vault/CRM/v.0.md` §§2.7 e 2.8; sub-projeto 2 entregue em `master` (`b2b5322`)
Status: aprovado no brainstorming, pronto para `writing-plans`

---

## 1. Contexto e recorte

O sub-projeto 2 entregou o lead do Meta e do Google caindo no funil sozinho, com dedup e sino em tempo real. O que ele **não** entregou é a leitura desse volume: hoje não há tela que responda "por que o lead não fecha" nem "qual anúncio traz lead que fecha".

Este sub-projeto entrega as duas coisas juntas, porque uma depende da outra: **rastreamento de origem em nível de anúncio**, e a **aba de Métricas** que o consome.

**Escopo:** colunas de rastreamento (campanha, conjunto, anúncio, formulário, click id) preenchidas pelos dois provedores; três visões de métrica (funil cumulativo, distribuição de etiquetas por etapa, conversão por canal com expansão até anúncio); e o porte do sistema de design do gestor-tráfego para o CRM inteiro.

**Fora de escopo:** custo por lead e CPL/CPA (exigem Google Ads API com developer token e Marketing API do Meta — fase 2 na própria `v.0.md`); resolução de nomes de campanha do Google (mesma razão); performance por vendedor como visão própria (o filtro por responsável já cobre a pergunta); exportação; gráficos de série temporal; quebra por formulário.

### Por que rastreamento e métricas no mesmo plano

Separados, a expansão por campanha nasceria em cima de `campanha_origem`, que **guarda coisas diferentes por provedor**: no Meta é o nome da campanha (`campaign{name}`, `meta-real.ts:147`), no Google é o id numérico (`String(payload.campaign_id)`, `mapear-google.ts:91`). A tabela de canais mostraria `Black November` numa linha e `123456789` na outra, e seria reescrita no plano seguinte. Fazer junto constrói a tela uma vez só.

### Sobre o tamanho: um plano ou dois

A decisão do brainstorming foi **um plano só** para rastreamento e métricas, e ela continua valendo — foi tomada para evitar construir a tela de canais duas vezes. Mas o porte do sistema de design entrou no escopo **depois** dessa decisão, e ele é uma terceira frente: converte 15 arquivos que nada têm a ver com métricas.

Registro isso explicitamente para o `writing-plans` avaliar, em vez de decidir aqui por conta própria. O corte natural, se houver corte, é entre **design + rastreamento** (as duas frentes que mexem em código existente) e **métricas** (a que só acrescenta). O precedente do sub-projeto 2 é que um plano com três frentes fica irrevisável.

### Decomposição do MVP, revisada

1. Fundação + núcleo do funil — ✅ completo (Planos 1 e 2)
2. Ingestão automática — ✅ completo (Planos 3 e 4)
3. **Rastreamento + Métricas** ← este documento
4. Scripts de Venda + Tarefas
5. **Disparo de WhatsApp** — novo, ver §8

## 2. Decisões tomadas no brainstorming

| Decisão | Escolha | Razão |
|---|---|---|
| Conversão entre etapas | Funil cumulativo por profundidade alcançada | O funil permite pular etapa; contar só a transição direta faz etapa pulada parecer morta com venda saindo do outro lado |
| Filtro de período | Coorte pela criação do lead | É a pergunta que o produto existe para responder: "dos leads que o Meta mandou em julho, quantos fecharam". Comparável entre períodos e canais |
| Denominador das etiquetas | % dos leads que alcançaram a etapa | Frase acionável e imune a mudança de hábito de etiquetar. A leitura literal da v.0 (% sobre aplicações) se move quando o time passa a pôr duas etiquetas por lead |
| Granularidade de canal | Canal → campanha → anúncio, expansível | É onde a verba é decidida, e o público do produto compra tráfego. Formulário fica fora por cardinalidade |
| Forma da atribuição | Colunas de id **e** nome, agrupando por id | Renomear campanha no gerenciador é rotina e não pode partir o histórico em duas linhas |
| Permissão | Aba visível aos três papéis, escopo pela RLS existente | Zero superfície nova de autorização, num projeto com duas falhas de isolamento já corrigidas |
| Onde o cálculo mora | Híbrido: SQL dá uma linha por lead, domínio agrega | Concentra o SQL no que só o SQL faz bem e deixa toda regra que erra em silêncio sob teste unitário sem Docker |
| Sistema de design | Porta o do gestor-tráfego e converte o CRM inteiro, primeiro | Métricas nasce no sistema final em vez de construída e reestilizada |

### O que o ambiente impõe

**O Google só entrega ids.** O payload do Lead Form traz `campaign_id`, `adgroup_id`, `creative_id`, `form_id` e `gcl_id`, todos numéricos, sem nome nenhum. Resolver nome exige a Google Ads API com developer token — aprovação de semanas e um OAuth que o projeto evitou de propósito, já que o Google entrou como URL secreta por conta. O design exibe o id cru **rotulado como id**, nunca um número numa coluna chamada "nome".

**Não há dado em produção.** O webhook nunca foi verificado no painel do Meta, não existe URL pública e `META_APP_ID`/`META_APP_SECRET` estão vazios. Logo não há backfill a fazer, nem convivência de colunas legadas: `campanha_origem` e `formulario_origem` são simplesmente substituídas. Esta janela fecha no primeiro deploy — se o app subir antes deste sub-projeto, os leads recebidos nesse intervalo ficam sem anúncio para sempre, porque o Graph só devolve o lead enquanto o `leadgen_id` existir.

**Armadilha herdada (continua valendo):** nesta versão do `supabase/postgres` (17.6) o default ACL do schema `public` concede a `anon`/`authenticated` apenas `Dxtm`. Este sub-projeto não cria tabela, mas cria **funções**, e elas precisam de `grant execute` explícito para `authenticated`.

**Armadilha herdada:** o binário `supabase` não está no PATH; só `npx supabase` funciona.

## 3. Rastreamento — modelo de dados

Migration `0013`. Substitui duas colunas de texto ambíguas por pares id/nome em `public.leads`:

```
remove    campanha_origem      -- nome no Meta, id no Google: ambíguo por construção
          formulario_origem

adiciona  campanha_id    text     campanha_nome   text
          conjunto_id    text     conjunto_nome   text
          anuncio_id     text     anuncio_nome    text
          formulario_id  text
          click_id       text
```

Todas nullable: lead manual não tem nenhuma, lead do Google não tem nome nenhum.

`leads.origem` (enum `meta|google|manual|indicacao|organico`) **não muda** — ele continua sendo o canal, e o rastreamento são os níveis abaixo dele.

Nenhuma tabela nova, nenhuma policy nova: as colunas herdam a RLS de `leads`, que já é `pode_ver_lead`.

### Preenchimento no Meta

`buscarLead` já devolve `ad_id` e `form_id` (`meta-real.ts:125`). O método `campanhaDoAnuncio(adId, token)` é **substituído** por:

```
arvoreDoAnuncio(adId, tokenDaPagina): Resultado<ArvoreDeAnuncio>
  GET /{ad_id}?fields=name,adset{id,name},campaign{id,name}
```

Mesma ida ao Graph que hoje, três níveis em vez de um nome. `formulario_nome` fica fora: exigiria uma segunda chamada por lead e o id já identifica o formulário.

**Best-effort, sem ambiguidade.** A regra atual (`processar.ts:91` e `:98`) grava o `ad_id` cru em `campanhaOrigem` como fallback, criando exatamente o dado ambíguo que esta migration remove. A nova regra: se `arvoreDoAnuncio` falhar, grava `anuncio_id` — que veio de `buscarLead`, não da chamada que falhou — e deixa os outros seis nulos. **Nenhum campo mente sobre o que é.**

### Preenchimento no Google

Mapeamento direto, sem chamada de rede:

| Payload | Coluna |
|---|---|
| `campaign_id` | `campanha_id` |
| `adgroup_id` | `conjunto_id` |
| `creative_id` | `anuncio_id` |
| `form_id` | `formulario_id` |
| `gcl_id` | `click_id` |

Todos os `_nome` ficam nulos.

`click_id` não serve a nada hoje. Entra porque chega de graça no payload e é a única chave que um dia fecha o laço de conversão offline de volta no Google Ads — capturar depois é impossível para o lead que já passou.

## 4. Métricas — arquitetura

### 4.1 As duas RPCs

Ambas `security invoker`: a RLS existente recorta dentro do banco, e nenhum código de autorização novo é escrito. Vendedor recebe só a coorte dele porque `pode_ver_lead` já diz isso.

**`metricas_coorte(p_pipeline_id, p_de, p_ate, p_responsavel_id default null)`** → uma linha por lead:

```
lead_id, criado_em, origem, status, responsavel_id,
campanha_id, campanha_nome, conjunto_id, conjunto_nome,
anuncio_id, anuncio_nome, ordem_max
```

`ordem_max` é a maior `stages.ordem` entre etapas **de tipo `aberta`** que o lead já ocupou, calculada sobre a união de:

- `stage_history.stage_origem`
- `stage_history.stage_destino`
- o `leads.stage_id` atual

Essa união é completa **sem backfill nenhum**, e essa é a razão de a linha de entrada faltante não ser carga estrutural: `move_lead_stage` é o único caminho de troca de etapa e sempre grava histórico, então a etapa inicial de um lead que se moveu aparece como `stage_origem` do primeiro movimento; a de um lead que nunca se moveu é o `stage_id` atual.

O filtro por `tipo = 'aberta'` é obrigatório: no pipeline padrão `Ganho` e `Perdido` têm `ordem` 6 e 7, maiores que todas as etapas abertas, e sem o filtro todo lead perdido apareceria como tendo alcançado o fundo do funil.

**`ordem_max = 0`** quando o lead nunca ocupou etapa aberta. Ele entra no total da coorte e em nenhum degrau.

**`metricas_etiquetas(mesmos argumentos)`** → uma linha por aplicação de etiqueta dos leads da coorte:

```
lead_id, tag_id, tag_nome, stage_id_no_momento, ordem_no_momento
```

**A coorte é `leads.criado_em >= p_de and leads.criado_em < p_ate`** — intervalo semiaberto, para que dois períodos adjacentes nunca contem o mesmo lead duas vezes. Vale para as duas RPCs.

Os filtros são argumentos das RPCs, não `WHERE` em TypeScript: o volume fica limitado no banco.

### 4.2 O port

`store.ts` ganha dois métodos, devolvendo `Resultado<T>` como todo o resto:

```ts
metricasDaCoorte(f: FiltroMetricas): Promise<Resultado<LinhaCoorte[]>>
etiquetasDaCoorte(f: FiltroMetricas): Promise<Resultado<AplicacaoEtiqueta[]>>
```

Implementados em `supabase.ts` (chamada de RPC) e em `memory.ts` (in-memory), seguindo o padrão que o repo já usa.

### 4.3 O domínio

`src/lib/domain/metricas.ts`, funções puras sem IO. É aqui que mora **toda regra que pode estar errada de um jeito silencioso**, deliberadamente, porque é o lado que tem teste rápido e sem Docker.

**`funilDaCoorte(linhas, etapas)`**

Para cada etapa aberta em ordem crescente, `alcancaram = linhas.filter(l => l.ordemMax >= etapa.ordem).length`. O percentual de cada degrau é sobre o degrau anterior; o primeiro é 100% de si mesmo.

O cabeçalho mostra o **total da coorte** separado do primeiro degrau. Quando divergem — leads com `ordem_max = 0` — isso fica visível em vez de escondido.

Abaixo, os desfechos, derivados de `status`: ganhos, perdidos, ainda abertos.

**`etiquetasPorEtapa(linhas, aplicacoes, stageId)`**

- Numerador por etiqueta: leads distintos cuja aplicação tem `stage_id_no_momento = stageId`.
- Denominador: leads da coorte com `ordemMax >= ordem(stageId)` — exatamente o número que o funil mostra naquele degrau.
- Ordenação por contagem decrescente, **desempate por nome**. Este projeto já foi mordido por empate de ordenação (backlog #10, fechado no Plano 3); nenhuma ordenação nova nasce sem desempate determinístico.

Percentuais somam mais de 100% de propósito, porque um lead carrega várias etiquetas. A tela diz isso.

**`canaisDaCoorte(linhas)`**

Três níveis: `origem` → `campanha_id` → `anuncio_id`. Em cada nível: leads, ganhos, perdidos, ainda abertos, e **taxa de ganho = ganhos / leads** — com os ainda abertos no denominador de propósito, pela mesma censura à direita que a coorte já assume, e a coluna "aberto" ao lado para o leitor ver quanto ainda está em jogo.

- Agrupa por **id**; o nome exibido é o do lead mais recente (`max(criadoEm)`) que carrega aquele id. Renomear campanha no Meta não parte o histórico.
- Se todos os nomes daquele id forem nulos (caso Google), exibe o id cru rotulado como id.
- `id` nulo vira um grupo `(sem campanha)` / `(sem anúncio)` explícito — nunca some da conta do canal.

### 4.4 Volume e o ponto de troca

Uma linha por lead e uma por aplicação de etiqueta. Para 5.000 leads em 90 dias, ~5.000 + ~8.000 linhas por carregamento — adequado à escala do MVP.

**O ponto de troca fica escrito:** quando uma conta passar de ~20.000 leads na janela, a agregação desce para SQL, e as funções de domínio deste sub-projeto viram o oráculo dessa migração — o resultado novo tem que bater com o antigo nos mesmos casos de teste.

## 5. Sistema de design

### 5.1 Estado de partida

O `globals.css` do CRM é o starter do Next.js intocado: dois tokens e `font-family: Arial`. As telas usam classes cruas do Tailwind — 44 ocorrências de `bg-white`, `text-gray-600` e afins em 15 arquivos, tema claro chumbado.

O gestor-tráfego tem sistema completo, e ele foi construído para dashboard: a utilitária `.tabular` tem no arquivo o comentário "Números de métrica alinhados em colunas", e `--chart-1` a `--chart-5` já existem.

### 5.2 O porte, sem dependência nova

O `globals.css` do gestor-tráfego importa `shadcn/tailwind.css` e `tw-animate-css`, mas **nada do que importa depende deles**: as classes saem do `@theme inline` local e o `.fade-in` é definido no próprio arquivo. Os dois imports caem.

Vem inteiro:

- Paleta "sala de operação": `--background: #070b16`, `--primary: #3d7bff`, `--success: #35d0a5`, `--destructive: #f2637e`, superfícies em navy elevado, texto `#eaf0fb`.
- Escala de raio (`--radius: 0.75rem` e derivados) e `--chart-1..5`.
- Utilitárias `.tabular`, `.eyebrow`, `.surface`, `.accent-top`, `.fade-in` — com o `prefers-reduced-motion` que já vem junto.
- A assinatura: brilho azul radial no topo do body.
- Escuro por padrão, com `:root` e `.dark` carregando os mesmos tokens.

Fontes: Inter (`--font-sans`) e Space Grotesk (`--font-display`) via `next/font/google`, que já é do Next. Geist sai.

**Nenhum shadcn, nenhum base-ui, nenhuma dependência nova.** Os componentes do CRM continuam os que existem; passam a falar tokens.

### 5.3 Conversão das telas, com portão mecânico

Mapa direto: `bg-white` → `bg-card`, `text-gray-600` → `text-muted-foreground`, `border-gray-*` → `border-border`, `bg-blue-600` → `bg-primary`, `text-red-*` → `text-destructive`.

O repo **não tem infraestrutura de teste de componente** (nenhum `*.test.tsx`; `vitest.config.ts` é `environment: 'node'` com `include: ['src/**/*.test.ts']`, então `.tsx` nem é coletado). A dívida é conhecida e continua aberta — este plano não a paga.

No lugar, a completude ganha rede **mecânica**: um teste que varre `src/` e falha se sobrar qualquer classe de paleta crua do Tailwind. Roda em milissegundos, é determinístico, não depende de olho, e transforma "converti tudo" de afirmação em fato verificado. Os fluxos continuam cobertos pelos 10 specs E2E.

Isso não cobre regressão *visual* — silhueta, espaçamento, feedback de arrastar. Risco aceito conscientemente, com o precedente registrado: no Plano 2, o feedback visual do drag-and-drop simplesmente não existia e só o E2E pegou.

## 6. UI

Rota `/metricas`, na navegação para os três papéis.

**Filtros no topo**, compartilhados pelas três visões: período (7 / 30 / 90 dias ou intervalo customizado), pipeline, e responsável — este último renderizado só para admin e gestor, porque para o vendedor seria uma lista de um item.

**Funil** — barras horizontais decrescentes em `--chart-1`, com absoluto e percentual sobre o degrau anterior, `.tabular` nos números. Três cards `.surface` abaixo: ganhos, perdidos, ainda abertos.

**Etiquetas** — seletor de etapa e ranking com barra proporcional. O denominador aparece no cabeçalho ("51 leads chegaram em Fechamento"), para o percentual nunca ficar solto.

**Canais** — tabela de três níveis expansíveis, `.tabular` nas colunas numéricas.

**Sem biblioteca de gráfico.** As barras são `div` com largura percentual. Três visões simples não pagam a superfície de um Recharts, e `--chart-1..5` já dá a cor.

### Dois estados que não são detalhe

- **Coorte vazia** é o caso mais provável em conta nova. A tela diz o que fazer (conectar fonte, cadastrar lead), não "sem dados".
- **Censura à direita** fica escrita na tela: o período corrente avisa que lead recente ainda está descendo o funil. É consequência direta da coorte por criação, e sem o aviso o número engana quem compara julho com agosto no dia 2.

### Erro

`Resultado<T>` como o resto, com mapa de mensagens **próprio da tela**. O backlog aponta ~30 sítios vazando mensagem crua do PostgREST para a UI; esta nasce certa. Códigos: `periodo_invalido` (de > até), `pipeline_invalido`, `indisponivel`.

## 7. Estratégia de teste

**Unitário (sem Docker)** — as três funções de domínio. É onde está toda a regra de negócio, e por isso o grosso da cobertura:

- Funil: lead que pulou etapa conta nos degraus pulados; lead que voltou etapa mantém a profundidade; lead perdido no degrau 2 não aparece no degrau 3; `ordem_max = 0` entra no total e em nenhum degrau.
- Etiquetas: denominador bate com o degrau do funil; empate de contagem desempata por nome; etiqueta aplicada em etapa que ninguém alcançou não aparece.
- Canais: renomear campanha não parte o grupo; id sem nome exibe o id; `null` vira `(sem campanha)` e a soma dos grupos fecha com o total do canal.

**Integração contra Postgres real** — as duas RPCs, com três casos que discriminam:

- Lead que **pulou** etapa e lead que **voltou** etapa produzem o `ordem_max` correto.
- Lead perdido não herda a `ordem` alta da etapa `Perdido`.
- **Vendedor chamando a RPC recebe só a coorte dele.** Com duas falhas de isolamento já corrigidas neste projeto, este é o teste que não se abre mão.

Mais um **pipeline reordenado** em pelo menos um teste: sem isso, "primeira etapa" passa por acidente do seed. É a lição do teste vácuo do Plano 4.

**Portão de estilo** — a varredura de classe crua descrita em §5.3.

**E2E** — um spec: admin abre `/metricas`, vê as três visões com dado semeado, expande um canal até o anúncio, e troca o filtro de período vendo o número mudar. Lembrete de ambiente: derrubar qualquer `npm run dev` aberto antes, e a suíte roda com `workers: 1` de propósito.

**Regra de asserção que continua valendo:** asserção negativa só é segura quando uma positiva que só vale no estado pós-mudança já passou sobre a mesma subárvore. E teste que se afirma discriminante sem experimento não conta — quebrar o comportamento de propósito e ver vermelho é o que vale.

## 8. Sub-projeto 5 — Disparo de WhatsApp (fora deste plano)

Registrado aqui para não se perder, e **explicitamente fora deste sub-projeto**.

O pedido é montar template, submeter ao Meta para análise de conformidade, e disparar. Isso não é uma feature: é WABA e número verificado, App Review de `whatsapp_business_messaging` e `whatsapp_business_management`, CRUD de template com categoria e variáveis, submissão com estados `PENDING`/`APPROVED`/`REJECTED` chegando por webhook assíncrono (`message_template_status_update`), a janela de 24 horas que decide entre texto livre e template aprovado, opt-in obrigatório por política, e webhooks de entrega. Tamanho comparável ao sub-projeto 2, que consumiu dois planos e 21 tarefas.

Fica **depois** de Scripts + Tarefas (sub-projeto 4), por duas razões: template de WhatsApp se apoia na biblioteca de Scripts e no agendamento de Tarefas, que são exatamente o que o 4 entrega; e o App Review tem prazo de calendário, não de código, então correr em paralelo aos outros planos é ganho puro.

**Ação destravável desde já, independente de qualquer plano:** `META_APP_ID` e `META_APP_SECRET` estão vazios e não há URL pública. Isso já bloqueia as verificações pendentes do sub-projeto 2 (webhook no painel do Meta, `META_REDIRECT_URI`, dados de teste do Google, `posseDaPagina` contra o Graph real, cron na Vercel) e vai bloquear o WhatsApp pelo mesmo motivo. É o mesmo gargalo, e vale resolver antes.

## 9. Critério de aceite

Um admin abre `/metricas` num CRM que agora tem a cara do gestor-tráfego, escolhe "últimos 30 dias", e vê:

- o funil da coorte decrescendo degrau a degrau, com os leads que pularam etapa contados nos degraus que pularam;
- selecionando "Fechamento", quais etiquetas os leads que chegaram lá carregavam, em percentual sobre esses leads;
- a tabela de canais, onde ele expande Meta, encontra a campanha, expande a campanha e **descobre qual anúncio traz o lead que fecha** — que é a pergunta que fez este sub-projeto existir.

E um vendedor abre a mesma tela e vê exatamente as mesmas três visões, calculadas apenas sobre os leads dele, sem uma linha de código de autorização escrita para isso.
