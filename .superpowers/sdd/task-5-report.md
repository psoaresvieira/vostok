# Task 5 report: Painel de tarefas na ficha do lead

Nota: este arquivo continha, antes desta execucao, o report da Task 5 de um
plano anterior (plano-6-metricas, "A tela /metricas") — numeracao reusada
entre planos diferentes. Sobrescrito abaixo com o report desta task
(plano-7-tarefas, Task 5: "Painel de tarefas na ficha do lead").

## O que foi implementado

- `src/app/(app)/tarefas/erros.ts` (novo) — mapa unico `mensagemDeErroTarefa`,
  cobrindo `titulo_vazio`, `prazo_invalido`, `tarefa_nao_encontrada`,
  `lead_nao_encontrado`, `sem_sessao`, `erro_ao_criar_tarefa`,
  `erro_ao_carregar_tarefas`, `erro_ao_atualizar_tarefa` e
  `[FALHA_DE_CONEXAO]: MENSAGEM_FALHA_DE_CONEXAO`. Importado pelo painel da
  ficha (Task 5) e pronto para a tela `/tarefas` (Task 6).
- `src/app/(app)/tarefas/acoes.ts` (novo) — `criarTarefa`, `concluirTarefa`,
  `reabrirTarefa`, `excluirTarefa`, todas `'use server'`, resolvendo
  `criarTarefaStoreDoServidor()`, nunca `new SupabaseTarefaStore(...)`.
  Cada uma faz `revalidatePath` de `/leads/${leadId}` e de `/tarefas`.
  `criarTarefa` valida titulo (trim vazio → `titulo_vazio`) e valida
  `venceEmISO` construindo o `Date` e checando `Number.isNaN(...getTime())`
  **antes** de repassar ao port → `prazo_invalido`.
- `src/app/(app)/leads/[id]/tarefas.tsx` (novo) — componente cliente
  `PainelTarefas({ leadId, tarefas, agora })`. Formulario de criacao
  (titulo, tipo, prazo `datetime-local`) + duas secoes (`Abertas` /
  `Concluidas`), cada item mostrando rotulo de urgencia ("Atrasada" /
  "Vence hoje") via `classificar` de `@/lib/domain/tarefa` — nunca
  reimplementado. Toda chamada de acao passa por `chamarAcao`. `agora` e
  `tarefas` chegam por prop; o componente nunca chama `new Date()`.
- `src/app/(app)/leads/[id]/tarefas.test.tsx` (novo) — ver casos abaixo.
- `src/app/(app)/leads/[id]/page.tsx` (modificado) — `criarTarefaStoreDoServidor()`
  entrou no `Promise.all` existente; `store.doLead(id)` busca as tarefas do
  lead com o mesmo tratamento de erro (`if (!x.ok) throw new Error(x.erro)`)
  das outras chamadas. `PainelTarefas` renderizado na coluna esquerda,
  abaixo de `AcoesLead`.
- `src/app/(app)/leads/[id]/timeline.tsx` (modificado) — `case 'tarefa_concluida'`
  em `rotuloEvento`, lendo `titulo` do payload: `` `Tarefa concluída: ${titulo}` ``.
- `src/app/(app)/leads/[id]/timeline.test.tsx` (modificado) — ver secao
  dedicada abaixo.
- `src/lib/data/tarefas.ts` (modificado, fora da lista literal do brief —
  ver "Desvio do file list" abaixo) — `SupabaseTarefaStore.concluir` agora
  seleciona `lead_id, titulo, tipo` no mesmo `update` e, em caso de sucesso,
  insere o evento `tarefa_concluida` em `lead_events` com esse snapshot.

## Casos de teste (`tarefas.test.tsx`)

1. **"marca a tarefa vencida ontem como atrasada e nao marca a de semana que
   vem"** — duas tarefas, uma com `venceEm` de ontem e outra de 6 dias no
   futuro, `agora` fixo por prop. Afirma que o `<li>` da tarefa atrasada
   contem texto `/atrasada/i` e que o `<li>` da tarefa futura NAO contem.
   Assert por texto, nunca por classe CSS.
2. **"lista tarefas abertas antes das concluidas, e a concluida aparece na
   secao de concluidas"** — uma aberta e uma concluida (`concluidaEm` !=
   null). Afirma por **posicao**: indice da aberta em `getAllByRole('listitem')`
   e menor que o da concluida. Afirma tambem que o item concluido esta
   dentro do `<section>` cujo heading casa `/conclu[íi]das/i`.
3. **"mostra o estado vazio quando nao ha tarefas"** — `tarefas={[]}`.
   Afirma texto `/nenhuma tarefa/i` e zero `listitem`.

## Evidencia de TDD

**RED** — `npm test -- tarefas` antes de criar `tarefas.tsx`:
```
FAIL  src/app/(app)/leads/[id]/tarefas.test.tsx [ src/app/(app)/leads/[id]/tarefas.test.tsx ]
Error: Failed to resolve import "./tarefas" from "src/app/(app)/leads/[id]/tarefas.test.tsx".
Does the file exist?
```
Falha esperada: o componente ainda nao existia, entao o proprio import
quebrava a suite antes de qualquer teste rodar.

**GREEN** — apos implementar `tarefas.tsx`, `acoes.ts`, `erros.ts`:
```
npm test -- tarefas
 Test Files  1 passed (1)
      Tests  3 passed (3)

npm test -- timeline
 Test Files  1 passed (1)
      Tests  3 passed (3)

npm test
 Test Files  30 passed (30)
      Tests  292 passed (292)
```
Os 3 casos de `tarefas.test.tsx` passaram ja na primeira implementacao (sem
ciclo adicional de vermelho por bug).

## O que mudou em `timeline.test.tsx` e por que

O segundo caso de `describe('rotuloEvento', ...)` usava `'tarefa_concluida'`
como exemplo de tipo desconhecido caindo no `default`. Como o Step 4 desta
task adiciona `case 'tarefa_concluida'` ao switch, esse teste ficaria
vermelho — corretamente, nao por acidente. Troquei o tipo do evento de
teste para `'tipo_que_nao_existe'` (que continua sem `case` nenhum),
mantendo a intencao original: provar que o `default` protege a timeline de
tipos futuros ainda nao mapeados. Com o `case` novo ja no lugar e o teste
ainda usando `'tarefa_concluida'`, ele falhava com
`expected 'Tarefa concluída: ?' to be 'tarefa_concluida'`; depois da troca
para `'tipo_que_nao_existe'`, passa (confirmado em `npm test -- timeline`).

## Verificacao no navegador

Sem MCP de browser disponivel no ambiente do agente, usei Playwright
(ja dependencia do repo, Chromium ja instalado em `~/AppData/Local/ms-playwright`)
para dirigir um Chromium real contra `npm run dev` + Supabase local:

1. Cadastro de conta nova (`/signup`) → funil.
2. Criacao de lead → abertura da ficha (`/leads/[id]`) → heading "Tarefas"
   visivel no painel novo.
3. Criacao de uma tarefa (titulo, tipo "Ligacao", prazo `datetime-local`) →
   aparece imediatamente na secao "Abertas" com "vence 10/08/2026, 14:30".
4. Clique em "Concluir" → o item some de "Abertas" (que passa a mostrar
   "Nenhuma tarefa aberta.") e aparece em "Concluidas" com "concluida
   02/08/2026, 11:32" e botao "Reabrir".
5. A "Linha do tempo" (coluna direita) ganhou a linha nova no topo:
   **"Tarefa concluída: Ligar para confirmar reuniao"**, acima de "Lead
   criado (origem: manual)".
6. Rodada separada: criei uma tarefa com prazo de ontem e outra de daqui a
   7 dias. A tarefa de ontem mostrou o rotulo vermelho **"Atrasada"** ao
   lado do titulo; a tarefa futura nao mostrou rotulo nenhum.

Nada de errado visualmente: fonte, cores e espacamento consistentes com o
resto da tela (tema escuro, mesma tipografia sans-serif, mesmos botoes
`underline`/`text-destructive` do resto do app). Screenshots capturados em
`C:\Users\Pedro\AppData\Local\Temp\claude\...\scratchpad\0{1..5}-*.png` (seis
imagens: ficha antes, tarefa criada, tarefa concluida, timeline com
conclusao, atrasada-vs-futura).

Servidor de dev derrubado ao final (`taskkill` no PID escutando :3000);
nenhum processo de fundo ficou pendurado.

## Portao completo

```
npm test          → 30 arquivos, 292 testes, todos passando
npm run typecheck → sem erros
npm run lint      → sem warnings/erros
npm run build     → build de producao completo, 14 paginas geradas
```

## Desvio do file list do brief

O brief lista `src/lib/data/tarefas.ts` como arquivo intocado, mas a
decisao "concluirTarefa tambem insere o lead_events de tarefa_concluida"
nao tinha um jeito limpo de ser cumprida sem tocar nele:

- O `TarefaStore` (Task 4) so conhece a tabela `tasks`; nao expoe o cliente
  Supabase para `acoes.ts` nem tem metodo para escrever em `lead_events`.
- O `CrmStore` (dono de `lead_events`/`registrarNota`) tambem nao tem um
  metodo generico "registrar evento arbitrario" — so `registrarNota`, fixo
  no tipo `nota`.
- Em todo o repo, **nenhum arquivo em `src/app/` chama `.from(...)`
  diretamente** — toda leitura/escrita de tabela passa por uma classe em
  `src/lib/data/*`. Fazer a acao chamar `.from('lead_events')` cru quebraria
  essa convencao sem excecao.
- `SupabaseCrmStore` ja cruza fronteiras de tabela partindo de um metodo
  "de dominio" (ex: `aplicarEtiquetas` escreve em `tags`, `lead_tags` E
  `lead_events`; `atribuirResponsavel` escreve em `leads` e `lead_events`).
  Segui o mesmo padrao: `SupabaseTarefaStore.concluir` agora escreve em
  `tasks` e, em caso de sucesso, em `lead_events` — mesmo cliente
  Postgrest, mesma classe, sem expor nada novo para `acoes.ts`.

A interface `TarefaStore.concluir(id): Promise<Resultado<void>>` nao mudou
de assinatura, entao nao ha ripple em outros consumidores. Nao existe
`InMemoryTarefaStore` nem teste unitario de `SupabaseTarefaStore` hoje
(confirmado por busca antes de editar), entao a mudanca nao quebrou nenhuma
suite existente.

Diferente de `atribuirResponsavel` (que devolve `erroEvento.message` cru se
o insert do evento falhar — uma violacao pre-existente da regra "nenhuma
mensagem crua do Postgres", fora do escopo desta task), o codigo novo em
`concluir` devolve o codigo generico `erro_ao_atualizar_tarefa` se o insert
do evento falhar depois da tarefa ja ter sido concluida — nunca a mensagem
do Postgres.

## Self-review

- Conferido: nenhuma mensagem crua do Postgres alcanca `mensagemDeErroTarefa`
  nem o componente — todos os `falha(...)` em `acoes.ts` e `tarefas.ts`
  usam codigos conhecidos.
- Conferido: toda chamada de Server Action em `tarefas.tsx` passa por
  `chamarAcao`.
- Conferido: `classificar`/`FUSO_PADRAO` sao importados de
  `@/lib/domain/tarefa`, nunca reimplementados no componente.
- Conferido: `PainelTarefas` nunca chama `new Date()` internamente —
  `agora` chega por prop, `venceEmISO` chega do input do usuario.
- Conferido: `criarTarefa` valida `venceEmISO` construindo o `Date` e
  checando `Number.isNaN` **antes** de passar ao `store.criar`, seguindo a
  licao do Plano 6 citada no brief.
- Conferido: `afterEach(cleanup)` presente em `tarefas.test.tsx`, com o
  mesmo comentario de `timeline.test.tsx`.
- Conferido: `git status` limpo apos o commit; nenhum script de verificacao
  (`verificar-tarefas.mjs`, `verificar-atrasada.mjs`) ficou no repo — foram
  copiados para dentro do projeto so para resolver `node_modules`, rodados
  e removidos logo em seguida.

## Preocupacoes

- O desvio documentado acima (`src/lib/data/tarefas.ts` modificado) e a
  unica coisa fora do file list literal do brief. Julguei ser a unica forma
  consistente com as convencoes do resto do repo de cumprir a decisao "a
  conclusao escreve na timeline" sem violar "nenhum `.from()` cru em
  `src/app/`". Se o revisor preferir uma abordagem diferente (ex: expor um
  metodo generico em `CrmStore`), e uma mudanca isolada de reverter.
- Nao criei suite de teste automatizada para `SupabaseTarefaStore.concluir`
  (nao existe harness de integracao Supabase neste escopo, e a Task 4 ja
  nao tinha um `SupabaseTarefaStore.test.ts`); a cobertura desse caminho e
  so a verificacao manual no navegador (Step 6), que exercitou o fluxo
  completo concluir → evento na timeline.

## Arquivos alterados

- `C:\Users\Pedro\projects\crm\src\app\(app)\tarefas\erros.ts` (novo)
- `C:\Users\Pedro\projects\crm\src\app\(app)\tarefas\acoes.ts` (novo)
- `C:\Users\Pedro\projects\crm\src\app\(app)\leads\[id]\tarefas.tsx` (novo)
- `C:\Users\Pedro\projects\crm\src\app\(app)\leads\[id]\tarefas.test.tsx` (novo)
- `C:\Users\Pedro\projects\crm\src\app\(app)\leads\[id]\page.tsx` (modificado)
- `C:\Users\Pedro\projects\crm\src\app\(app)\leads\[id]\timeline.tsx` (modificado)
- `C:\Users\Pedro\projects\crm\src\app\(app)\leads\[id]\timeline.test.tsx` (modificado)
- `C:\Users\Pedro\projects\crm\src\lib\data\tarefas.ts` (modificado, ver "Desvio do file list")

Commit: `143a629` — "feat: painel de tarefas na ficha do lead, com a
conclusao na timeline"

---

## Rodada de correção — achados do review

Correções aplicadas por cima do commit `143a629`, na mesma branch
`plano-7-tarefas`. As duas decisões marcadas como fechadas no briefing da
rodada foram respeitadas: a assinatura de `criarTarefa({ leadId, titulo,
tipo, venceEmISO })` não mudou, e o `insert` do evento continua dentro de
`SupabaseTarefaStore.concluir`.

### Important 1 — prazo interpretado no fuso do browser

**O que mudou.** Nova função pura em `src/lib/domain/tarefa.ts`:
`instanteDeDatetimeLocal(naive, fuso)` (linhas 45-125), acompanhada do helper
privado `camposComoUTC` (linhas 51-75). Ela converte a string naive do
`<input type="datetime-local">` para o instante ISO **no fuso recebido por
parâmetro**, usando a mesma técnica que `diaCivil`/`somarDias` já usavam
naquele arquivo: resolver fuso via `Intl.DateTimeFormat`, aqui com
`formatToParts` para pegar a hora junto com a data.

Detalhes de implementação que valem registro:

- **Validação de calendário, não só de formato.** O regex sozinho aceita
  `2026-02-31T10:00` e `2026-08-10T10:99`, e `Date.UTC` transborda em silêncio
  (viram 3 de março e 11:39). Os campos são conferidos de volta contra o
  `Date` construído; se não baterem, é `null`.
- **Duas passadas para medir o deslocamento.** A primeira mede o offset no
  palpite (o naive lido como se fosse UTC), a segunda corrige o caso em que
  esse palpite caiu do outro lado de uma virada de horário de verão.
  `America/Sao_Paulo` não tem mais DST, mas a função recebe o fuso por
  parâmetro e não pode assumir isso.

Uso em `src/app/(app)/leads/[id]/tarefas.tsx:118-126` (função `criar`), no
lugar de `prazo ? new Date(prazo).toISOString() : ''`.

**Testes que cobrem, em `src/lib/domain/tarefa.test.ts`:**

- `caso que so o fuso resolve: a mesma string naive vira instantes diferentes
  em fusos diferentes` — a mesma string `'2026-08-10T14:30'` em
  `America/Sao_Paulo` e em `America/Manaus`. Uma implementação com
  `new Date(naive)` cru devolveria o mesmo instante para as duas, então
  **qualquer** fuso de máquina derruba pelo menos uma das asserções.
- `faz round-trip: reformatado no mesmo fuso, devolve a hora digitada` — trava
  a mentira de round-trip descrita no achado.
- `respeita horario de verao do fuso pedido, nao um deslocamento fixo` —
  `America/New_York` dos dois lados da virada de 2026-03-08.
- `entrada vazia devolve null, sem lancar` e `entrada malformada devolve null,
  sem lancar`.

**RED visto** (quebra deliberada: corpo da função trocado por
`return new Date(naive).toISOString()`, ignorando o fuso e voltando a lançar):

```
 FAIL  src/lib/domain/tarefa.test.ts > instanteDeDatetimeLocal > caso que so o fuso resolve: a mesma string naive vira instantes diferentes em fusos diferentes
AssertionError: expected '2026-08-10T17:30:00.000Z' to be '2026-08-10T18:30:00.000Z'
Received: "2026-08-10T17:30:00.000Z"

 FAIL  src/lib/domain/tarefa.test.ts > instanteDeDatetimeLocal > respeita horario de verao do fuso pedido, nao um deslocamento fixo
AssertionError: expected '2026-03-08T15:00:00.000Z' to be '2026-03-08T16:00:00.000Z'

 FAIL  src/lib/domain/tarefa.test.ts > instanteDeDatetimeLocal > entrada vazia devolve null, sem lancar
RangeError: Invalid time value
 > instanteDeDatetimeLocal src/lib/domain/tarefa.ts:94:26

 FAIL  src/lib/domain/tarefa.test.ts > instanteDeDatetimeLocal > entrada malformada devolve null, sem lancar
RangeError: Invalid time value
 > instanteDeDatetimeLocal src/lib/domain/tarefa.ts:94:26

 Test Files  1 failed (1)
      Tests  4 failed | 7 passed (11)
```

Vale notar que a máquina que rodou isto está em `America/Sao_Paulo` — por isso
a asserção de São Paulo passou com a implementação quebrada e a de Manaus não.
É exatamente por isso que o caso afirma sobre **dois** fusos.

### Important 2 — `toISOString()` podia lançar fora do alcance do `chamarAcao`

**O que mudou.** `src/app/(app)/leads/[id]/tarefas.tsx:118-126`: a conversão
do prazo acontece **antes** de `setEnviando(true)`, e `null` cai no mesmo
`setErro(mensagemDeErroTarefa('prazo_invalido'))` com `return`. Como a barreira
está antes de ligar `enviando`, não há caminho de erro que deixe o botão preso
em `disabled`. A validação no servidor (`acoes.ts:28-29`) continua no lugar,
intocada — o cliente é conveniência, a borda de verdade é a Server Action.

**Teste que cobre**, em `src/app/(app)/leads/[id]/tarefas.test.tsx`:
`prazo invalido mostra a mensagem de prazo e nao deixa o botao travado`.
Preenche o título, deixa o prazo vazio, clica em "Criar tarefa", e afirma que a
mensagem de `prazo_invalido` aparece e que `botao.disabled` é `false`.

**Nota sobre o que dá para injetar por um teste de componente.** Sondei o jsdom
antes de escrever o caso: ele aplica a mesma sanitização de valor que o browser
real faz em `<input type="datetime-local">` — tanto `'2026-02-31T10:00'` quanto
`'lixo total'` viram `''`. Então a string vazia é a única entrada inválida
injetável por esse caminho (e é também a que chega de um browser sem suporte a
`datetime-local`, onde o campo degrada para texto livre). O comentário no teste
registra isso.

**RED visto.** A primeira tentativa de RED *não* funcionou e isso mudou o
desenho do teste — registro porque é relevante: com o código antigo
(`prazo ? new Date(prazo).toISOString() : ''`), prazo vazio **não** lançava,
mandava `''` para a ação, e `criarTarefa` devolvia `prazo_invalido` antes de
tocar em `criarTarefaStoreDoServidor()`. O teste passava dos dois lados. O RED
válido veio de quebrar o comportamento exatamente na forma do defeito — a
conversão que lança na construção do argumento
(`venceEmISO: new Date(prazo).toISOString()`):

```
 FAIL  src/app/(app)/leads/[id]/tarefas.test.tsx > PainelTarefas > prazo invalido mostra a mensagem de prazo e nao deixa o botao travado
TestingLibraryElementError: Unable to find an element with the text: Esse prazo não é uma data válida.

------ Unhandled Errors ------
RangeError: Invalid time value
 > criar src/app/(app)/leads/[id]/tarefas.tsx:132:37
    132|         venceEmISO: new Date(prazo).toISOString(),
       |                                     ^
 > executeDispatch node_modules/react-dom/cjs/react-dom-client.development.js:16368:9

 Test Files  1 failed | 30 skipped (31)
      Tests  1 failed | 301 skipped (302)
     Errors  1 error
```

O vermelho mostra o modo de falha inteiro: o `RangeError` escapa como
*unhandled rejection* (fora do `try` do `chamarAcao`, que só protege a promessa
já criada), a mensagem nunca é renderizada, e o `setEnviando(false)` nunca roda.

### Important 3 — falha só do evento reportava a conclusão inteira como erro

**O que mudou, em três arquivos:**

1. `src/lib/data/tarefas.ts:67-77` — novo código exportado
   `TAREFA_CONCLUIDA_SEM_EVENTO = 'tarefa_concluida_sem_evento'`. Em
   `concluir` (linha ~232), `if (erroEvento) return falha(...)` passa a
   devolver esse código em vez de `ERRO_AO_ATUALIZAR_TAREFA`.
2. `src/app/(app)/tarefas/erros.ts:24-31` — a chave nova no mapa, com mensagem
   verdadeira: `'Tarefa concluída. Não conseguimos registrá-la na linha do
   tempo do lead.'`
3. `src/app/(app)/tarefas/acoes.ts:49-59` — `concluirTarefa` **revalida as
   telas mesmo neste caminho de erro**, porque o estado mudou. Sem isso o
   painel seguiria mostrando a tarefa aberta com o botão "Concluir", que é o
   que convidava o segundo clique e o re-carimbo.

**Onde a constante mora, e por quê ela não é importada pelo mapa de erro.**
`erros.ts` é importado por componente cliente. Importar um *valor* de
`@/lib/data/tarefas` arrastaria `@/lib/supabase/servidor` para `next/headers`
dentro do bundle do browser (o import de `Tarefa`/`TipoTarefa` em `tarefas.tsx`
é `import type`, apagado na compilação — por isso nunca doeu). Então a chave do
mapa é literal, como todas as outras daquele arquivo, e só o lado servidor
(`acoes.ts`) importa a constante. Está comentado nos dois lugares.

**Teste que cobre.** Precisei de um arquivo novo, `src/lib/data/tarefas.test.ts`
— fora da lista literal de arquivos da rodada, mas é o irmão `.test.ts` de um
arquivo que estava na lista, e era a única forma de forçar a falha do insert
do evento: a suíte de integração não consegue fazer o insert em `lead_events`
falhar sem mexer em policy. Ele monta um cliente Postgrest falso com só a
fatia de cadeia que `concluir` usa. Dois casos:

- `conclui a tarefa e escreve o evento de timeline com o snapshot do titulo` —
  o caminho feliz, que também trava o snapshot `{ titulo, tipo }` no payload.
- `quando so o insert do evento falha, a tarefa fica concluida e o codigo nao
  diz que a conclusao falhou` — afirma que o `update` de conclusão chegou a ser
  aplicado (`concluida_em` e `concluida_por` carimbados), que o código é
  `tarefa_concluida_sem_evento` e **não** `erro_ao_atualizar_tarefa`, que a
  mensagem traduzida casa `/conclu[íi]da/i` e não casa
  `/n[ãa]o foi poss[íi]vel atualizar/i`, que a mensagem crua do Postgres
  (`row-level security ... 42501`, devolvida de propósito pelo cliente falso)
  não vaza, e que o código não cai no fallback do mapa.

**RED visto** (revertendo só a linha do código de erro para
`falha(ERRO_AO_ATUALIZAR_TAREFA)`):

```
 FAIL  src/lib/data/tarefas.test.ts > SupabaseTarefaStore.concluir > quando so o insert do evento falha, a tarefa fica concluida e o codigo nao diz que a conclusao falhou
AssertionError: expected 'erro_ao_atualizar_tarefa' to be 'tarefa_concluida_sem_evento'

Expected: "tarefa_concluida_sem_evento"
Received: "erro_ao_atualizar_tarefa"

 > src/lib/data/tarefas.test.ts:108:20
 Test Files  1 failed (1)
```

**Sobre a guarda opcional no `update` (`concluida_em is null`): não fiz.**
Razões, para a triagem decidir: (a) ela troca a semântica de concluir uma
tarefa já concluída de "sucesso idempotente" para uma falha, e o
`if (!data || data.length === 0) return falha('tarefa_nao_encontrada')` logo
abaixo daria a essa falha uma mensagem mentirosa — precisaria de mais um código
(`tarefa_ja_concluida`) e de uma decisão sobre se isso é erro ou no-op, que é
desenho, não correção de review; (b) o motor do duplo-carimbo descrito no
achado era o painel não revalidar, e isso está corrigido acima; (c) o resto do
`TarefaStore` (`reabrir`, `excluir`) não tem guarda equivalente, e introduzir
uma só em `concluir` deixaria a camada inconsistente. Fica registrado junto com
o Minor da guarda de duplo clique.

### Important 4 — `case 'tarefa_concluida'` sem teste

**O que mudou.** Dois casos novos no `describe('rotuloEvento')` que já existia
em `src/app/(app)/leads/[id]/timeline.test.tsx` (linhas 45-67). `timeline.tsx`
**não** foi modificado — o achado era de cobertura, e o código já estava certo.

- `traduz tarefa_concluida lendo o titulo do payload` — cobre o ramo que lê
  `p.titulo`.
- `tarefa_concluida sem titulo no payload cai no fallback, nao em undefined` —
  cobre o `?? '?'`, que é o que impede a timeline de mostrar a string
  `'undefined'` para uma linha antiga ou gravada por outro caminho.

**RED visto**, em duas quebras separadas. Primeiro trocando `p.titulo ?? '?'`
por `p.titulo`, que isola o caso do fallback:

```
 FAIL  src/app/(app)/leads/[id]/timeline.test.tsx > rotuloEvento > tarefa_concluida sem titulo no payload cai no fallback, nao em undefined
AssertionError: expected 'Tarefa concluída: undefined' to be 'Tarefa concluída: ?'

 Test Files  1 failed (1)
```

Depois removendo o `case` inteiro, que derruba os dois — provando que os casos
novos são de fato os que seguram o `case` no lugar:

```
 > src/app/(app)/leads/[id]/timeline.test.tsx (5 tests | 2 failed)
     x traduz tarefa_concluida lendo o titulo do payload
     x tarefa_concluida sem titulo no payload cai no fallback, nao em undefined

AssertionError: expected 'tarefa_concluida' to be 'Tarefa concluída: Ligar para confirmar reuniao'
AssertionError: expected 'tarefa_concluida' to be 'Tarefa concluída: ?'
```

### Minors

**Acentuação em texto visível ao usuário.** Todas as mensagens de
`src/app/(app)/tarefas/erros.ts:9-30` acentuadas ("título", "não é uma data
válida", "Você", "sessão", "Não foi possível"). Em
`src/app/(app)/leads/[id]/tarefas.tsx`: "concluída" na linha secundária do item
(linha 60) e o placeholder "título da tarefa" (linha 157). Agora estão
consistentes com `ROTULO_TIPO` ("Ligação", "Reunião") e com
`timeline.tsx:32` ("Tarefa concluída"). Comentários de código e mensagem de
commit seguem sem acento, como o resto do repo.

**Imports relativos.** `src/app/(app)/leads/[id]/tarefas.tsx:7-13` passou de
`'../../tarefas/erros'` / `'../../tarefas/acoes'` para
`'@/app/(app)/tarefas/erros'` / `'@/app/(app)/tarefas/acoes'`. É a forma que
`acoes-lead.tsx:6-9`, no mesmo diretório, já usava para alcançar
`@/app/(app)/funil/*`.

Os demais Minors do review (duplicação dos três handlers, fixture do teste de
ordem, guarda de duplo clique, `throw` vs `redirect` no `page.tsx`, round-trip
extra de `auth.getUser()`) não foram tocados, conforme instruído.

### Portão

```
$ npm test -- tarefa

 RUN  v4.1.10 C:/Users/Pedro/projects/crm

 Test Files  3 passed (3)
      Tests  17 passed (17)
   Start at  17:14:05
   Duration  1.23s (transform 124ms, setup 0ms, import 456ms, tests 130ms, environment 699ms)
```

```
$ npm test -- timeline

 RUN  v4.1.10 C:/Users/Pedro/projects/crm

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  17:14:07
   Duration  1000ms (transform 30ms, setup 0ms, import 173ms, tests 18ms, environment 675ms)
```

```
$ npm run typecheck && npm run lint && npm run build

> crm@0.1.0 typecheck
> tsc --noEmit

> crm@0.1.0 lint
> next lint

`next lint` is deprecated and will be removed in Next.js 16.
No ESLint warnings or errors

> crm@0.1.0 build
> next build

   Collecting page data ...
   Generating static pages (14/14)
   Finalizing page optimization ...
   Collecting build traces ...

Route (app)                                 Size  First Load JS
- /                                        137 B         103 kB
- /_not-found                              993 B         104 kB
- /api/integracoes/meta/iniciar            137 B         103 kB
- /api/integracoes/meta/retorno            137 B         103 kB
- /api/webhooks/google/[token]             137 B         103 kB
- /api/webhooks/meta                       137 B         103 kB
- /api/webhooks/reprocessar                137 B         103 kB
- /config                                5.39 kB         108 kB
- /convite/[token]                         161 B         106 kB
- /funil                                 34.8 kB         141 kB
- /leads/[id]                            4.83 kB         111 kB
- /login                                 1.16 kB         107 kB
- /metricas                              1.75 kB         108 kB
- /signup                                1.23 kB         107 kB
+ First Load JS shared by all             103 kB
  Middleware                             91.9 kB
```

Suíte completa, já que `src/lib/data/tarefas.ts` foi tocado:

```
$ npm test

 Test Files  31 passed (31)
      Tests  302 passed (302)
```

**Integração rodada.** O Docker estava de pé e o stack local respondendo
(`npx supabase status` devolveu as URLs), então rodei a integração da Task 4
para confirmar que a mudança em `concluir` não a alterou:

```
$ npm run test:integration -- tarefas

 RUN  v4.1.10 C:/Users/Pedro/projects/crm

 Test Files  2 passed (2)
      Tests  15 passed (15)
   Start at  17:16:26
   Duration  4.94s (transform 75ms, setup 40ms, import 302ms, tests 4.33s, environment 0ms)
```

Nada de semântica mudou para a integração: no caminho feliz `concluir` continua
devolvendo `ok(undefined)`, e o código novo só aparece quando o insert em
`lead_events` falha — o que nenhum caso de integração provoca.

### Arquivos alterados nesta rodada

- `src/lib/domain/tarefa.ts` — `instanteDeDatetimeLocal` + `camposComoUTC`
- `src/lib/domain/tarefa.test.ts` — casos de `instanteDeDatetimeLocal`
- `src/app/(app)/leads/[id]/tarefas.tsx` — uso da função pura, tratamento de
  `null`, imports no alias, acentuação
- `src/app/(app)/leads/[id]/tarefas.test.tsx` — caso do prazo inválido
- `src/app/(app)/leads/[id]/timeline.test.tsx` — casos de `tarefa_concluida`
- `src/app/(app)/tarefas/erros.ts` — código novo + acentuação
- `src/app/(app)/tarefas/acoes.ts` — revalidação no caminho "concluída sem evento"
- `src/lib/data/tarefas.ts` — `TAREFA_CONCLUIDA_SEM_EVENTO`
- `src/lib/data/tarefas.test.ts` (novo) — `concluir` com cliente falso

`src/app/(app)/leads/[id]/timeline.tsx` **não** aparece na lista: o Important 4
era de cobertura, e o código já estava correto.

### Preocupações que sobram

- A guarda de `concluida_em is null` no `update` não foi feita, pelas razões
  registradas no Important 3. Se a triagem quiser, é mudança isolada, mas
  precisa de uma decisão de desenho junto (idempotente ou erro?).
- O teste de componente do prazo inválido só consegue exercitar a entrada
  vazia, porque jsdom e browser sanitizam `datetime-local`. A garantia de que
  entrada malformada não lança está no teste de domínio, não no de componente.
  A cobertura real do caminho "browser sem `datetime-local`" continua sendo por
  inspeção.
- `src/lib/data/tarefas.test.ts` usa cliente Postgrest falso, então trava o
  contrato do código (qual erro, qual payload) e não o comportamento do
  Postgres. A verdade sobre RLS e schema continua na suíte de integração.

Commit desta rodada: `c83d87b` — "fix: converte prazo no fuso do produto e
separa conclusao de evento falho", por cima de `143a629` em `plano-7-tarefas`.

---

## Segunda rodada de correção — achados da re-revisão

Escopo fechado: um Important e três Minors, todos em
`src/lib/data/tarefas.test.ts` e `src/lib/domain/tarefa.ts` (+ um teste novo,
`src/app/(app)/tarefas/erros.test.ts`, criado para acomodar o Minor 6). Por
cima do commit `c83d87b`, mesma branch `plano-7-tarefas`.

### Important 1 — asserção vazia por optional chaining em `tarefas.test.ts:83-84` e `:101-102`

**O bug.** `expect(estado.tarefaAtualizadaCom?.concluida_em).not.toBeNull()`:
se `tarefaAtualizadaCom` for `null` (update nunca chamado), o `?.` faz a
expressão inteira virar `undefined`, e `expect(undefined).not.toBeNull()`
**passa**. As duas linhas existiam para provar que "o update de conclusão
rodou antes do insert do evento falhar" — a invariante central do caso de
erro — e a asserção vazia deixava essa prova falsa.

**Correção, no caso de erro (`src/lib/data/tarefas.test.ts`, era :100-102,
agora dentro do segundo `it`):** troquei o par de `expect(...?.....)` por um
`if (estado.tarefaAtualizadaCom === null) throw new Error(...)` antes de
qualquer asserção de campo — isso falha o teste explicitamente se o update
nunca rodou, e dá ao TypeScript narrowing real (sem `?.` nem `!` depois).
Também reforcei o que "não nulo" prova: `concluida_em` agora é conferido como
`typeof ... === 'string'` e `!== ''`, não só "não é `null`":

```ts
if (estado.tarefaAtualizadaCom === null) {
  throw new Error('o update de tasks nao foi chamado antes do insert do evento falhar')
}
expect(typeof estado.tarefaAtualizadaCom.concluida_em).toBe('string')
expect(estado.tarefaAtualizadaCom.concluida_em).not.toBe('')
expect(estado.tarefaAtualizadaCom.concluida_por).toBe('user-1')
```

**No caso feliz (era :83-84):** essas duas linhas não sobreviveram como
"conserto" — foram removidas junto com o Minor 5 (abaixo), que reduz o caso
feliz à única asserção de valor durável. Ver seção do Minor 5.

**RED de verdade, visto e revertido.** Reordenei
`SupabaseTarefaStore.concluir` em `src/lib/data/tarefas.ts` para inserir o
evento **antes** do update (simulando exatamente o reorder que o achado
descreve), rodei `npx vitest run --config vitest.config.ts
src/lib/data/tarefas.test.ts`, e os dois casos ficaram vermelhos:

```
FAIL  src/lib/data/tarefas.test.ts > SupabaseTarefaStore.concluir > conclui a tarefa e escreve o evento de timeline com o snapshot do titulo
AssertionError: expected { titulo: '', tipo: 'outro' } to deeply equal { titulo: 'Ligar', tipo: 'ligacao' }

- Expected
+ Received

  {
-   "tipo": "ligacao",
-   "titulo": "Ligar",
+   "tipo": "outro",
+   "titulo": "",
  }

 ❯ src/lib/data/tarefas.test.ts:89:49

FAIL  src/lib/data/tarefas.test.ts > SupabaseTarefaStore.concluir > quando so o insert do evento falha, a tarefa fica concluida e o codigo nao diz que a conclusao falhou
Error: o update de tasks nao foi chamado antes do insert do evento falhar
 ❯ src/lib/data/tarefas.test.ts:104:13

 Test Files  1 failed (1)
      Tests  2 failed (2)
```

Por que os DOIS ficaram vermelhos, não só o caso de erro: no reorder, o
`insert` em `lead_events` acontece antes de o `update`/`select` em `tasks`
devolver a linha real — então o snapshot `{ titulo, tipo }` do caso feliz não
tem de onde vir a não ser um placeholder (usei `{ titulo: '', tipo: 'outro'
}`), o que já derruba a asserção de payload do Minor 5. No caso de erro, o
`insert` falha primeiro e o código (fiel ao bug descrito) devolve
`TAREFA_CONCLUIDA_SEM_EVENTO` sem nunca ter chamado `update` — exatamente o
cenário que o `if (... === null) throw` acima existe para pegar.

Revertido logo em seguida (`git diff` confirmou zero mudança em
`src/lib/data/tarefas.ts` depois do revert); `npm test -- tarefa` voltou a
19/19 verdes.

### Minor 5 — caso feliz media forma da chamada, não efeito

**O que mudou**, no `it('conclui a tarefa e escreve o evento de timeline com
o snapshot do titulo', ...)`: removidas as duas asserções sobre
`tarefaAtualizadaCom` (argumentos passados a `.update()`) e o
`toMatchObject({ lead_id, tipo, payload, ator_id })`. Ficou:

```ts
expect(r.ok).toBe(true)
expect(estado.eventosInseridos).toHaveLength(1)
expect(estado.eventosInseridos[0]?.payload).toEqual({ titulo: 'Ligar', tipo: 'ligacao' })
```

Única asserção com valor durável: o payload snapshot `{ titulo, tipo }`, que
é o contrato real com a leitura em `timeline.tsx:32`
(`` `Tarefa concluída: ${payload.titulo}` ``). O cliente falso já ignora a
coluna do `.eq()` (`:31-33`) e a lista do `.select()` (`:34-35`) de propósito
— não dava pra essas asserções provarem nada sobre filtro/coluna errados de
qualquer forma. O RED acima (Important 1) confirma que essa única asserção
restante já é suficiente para pegar um reorder que corrompe o snapshot.

**Caso de erro:** não mexido além do exigido pelo Important 1 e pelo Minor 6
— igual a antes, ainda usa o cliente falso pra alcançar o ramo que a
integração não consegue provocar sem mexer em policy.

### Minor 6 — teste de `src/lib` importava módulo de rota

**O que mudou:**

1. `src/lib/data/tarefas.test.ts:7` — removida a linha
   `import { mensagemDeErroTarefa } from '@/app/(app)/tarefas/erros'`.
2. No segundo `it` (caso de erro), as asserções sobre a mensagem traduzida
   (chamada a `mensagemDeErroTarefa`, regex de `/conclu[íi]da/i`, etc.) saíram
   do arquivo. No lugar, o teste do store afirma só sobre o **código**
   devolvido e que esse código não é a string crua do Postgres:

   ```ts
   expect(r.erro).toBe(TAREFA_CONCLUIDA_SEM_EVENTO)
   expect(r.erro).not.toBe('erro_ao_atualizar_tarefa')
   expect(r.erro).not.toMatch(/row-level security|42501/)
   ```
3. **Novo arquivo** `src/app/(app)/tarefas/erros.test.ts`, com as asserções de
   mensagem que saíram de `tarefas.test.ts`, agora testando
   `mensagemDeErroTarefa(TAREFA_CONCLUIDA_SEM_EVENTO)` diretamente (import de
   `TAREFA_CONCLUIDA_SEM_EVENTO` de `@/lib/data/tarefas` — seguro num arquivo
   de teste, que roda em Node via Vitest e nunca é bundlado pro browser; a
   restrição do comentário em `erros.ts:23-26` é sobre o **módulo** do mapa,
   não sobre os testes dele). Dois casos: a tradução de
   `tarefa_concluida_sem_evento` (mesmas quatro asserções que saíram do teste
   do store) e um caso extra de cobertura do fallback (código desconhecido
   devolve o próprio código).

Coletado automaticamente pelo `vitest.config.ts` (`include:
['src/**/*.test.{ts,tsx}']`), confirmado — ver contagem de arquivos abaixo
(31 → 32).

### Minor 2 — `tarefa.ts:102-111` não conferia os segundos

**O que mudou**, em `src/lib/domain/tarefa.ts` (função
`instanteDeDatetimeLocal`): extraída a variável `segundoNumero = segundo ?
+segundo : 0` (reaproveitada também no `Date.UTC(...)` logo acima, que já
fazia esse cálculo inline — elimina a duplicação em vez de repetir a
expressão), e adicionada `provisorio.getUTCSeconds() !== segundoNumero` à
lista de condições do `if` que decide `return null`. Antes, `'2026-08-10T10:00:99'`
transbordava em silêncio para `10:01:39` e passava — o mesmo modo de falha
que ano/mês/dia/hora/minuto já barravam, só que sem o segundo na lista.

**Teste novo**, em `src/lib/domain/tarefa.test.ts`, dentro do `it('entrada
malformada devolve null, sem lancar', ...)` já existente:

```ts
expect(instanteDeDatetimeLocal('2026-08-10T10:00:99', FUSO_PADRAO)).toBeNull()
```

Confirmado que falha sem a correção e passa com ela (rodei `npm test --
tarefa` antes e depois de aplicar a condição nova).

### Minor 3 — comentário sobre hora inexistente em virada de DST

**O que mudou:** só comentário, em `src/lib/domain/tarefa.ts`, logo antes do
cálculo do ponto fixo (linhas ~118-129 depois da edição). Registra que para um
horário LOCAL INEXISTENTE por "spring forward" (ex: `America/New_York`,
`'2026-03-08T02:30'`), o ponto fixo converge para o instante que, relido no
fuso, cai **antes** da virada (01:30) em vez de ser empurrado para depois
dela (03:30, o modo "compatible" de browsers/`Temporal`). Registra também que
`America/Sao_Paulo` não tem esse buraco e nenhum chamador do repo passa outro
fuso hoje, mas a função é genérica por assinatura. **Algoritmo do ponto fixo
não foi tocado**, como instruído.

### Portão

```
$ npm test -- tarefa

 Test Files  4 passed (4)
      Tests  19 passed (19)
```

```
$ npm run typecheck

> crm@0.1.0 typecheck
> tsc --noEmit

(sem saida, sem erros)
```

```
$ npm run lint

> crm@0.1.0 lint
> next lint

`next lint` is deprecated and will be removed in Next.js 16.
No ESLint warnings or errors
```

Suíte completa, já que `src/lib/domain/tarefa.ts` e `src/lib/data/tarefas.test.ts`
foram tocados:

```
$ npm test

 Test Files  32 passed (32)
      Tests  304 passed (304)
```

32 arquivos (31 → 32, `erros.test.ts` novo) e 304 testes (302 → 304: +2 de
`erros.test.ts`; o caso de segundos entrou dentro de um `it` já existente,
não conta como teste novo).

### Arquivos alterados nesta rodada

- `src/lib/data/tarefas.test.ts` — Important 1 (if-throw em vez de `?.`,
  no caso de erro), Minor 5 (caso feliz reduzido ao payload snapshot), Minor 6
  (import de `@/app/(app)/tarefas/erros` removido, asserções de mensagem
  saíram)
- `src/app/(app)/tarefas/erros.test.ts` (novo) — Minor 6, asserções de
  mensagem traduzida movidas para cá
- `src/lib/domain/tarefa.ts` — Minor 2 (`getUTCSeconds()` na validação),
  Minor 3 (comentário sobre DST)
- `src/lib/domain/tarefa.test.ts` — caso de segundo fora de faixa (Minor 2)

Nenhum arquivo fora desses quatro foi tocado. Os Minors fora de escopo desta
rodada (guarda `concluida_em is null`, `disabled` por item, duplicação dos
handlers, `<label>`, confirmação no Excluir, `Promise.all` do `page.tsx`,
`throw` vs `redirect`, cobertura de `acoes.ts`, aviso de `next lint`) não
foram tocados, como instruído.

### Preocupações que sobram

Nenhuma nova. As preocupações já registradas na rodada anterior (guarda de
`concluida_em is null` não feita, cobertura do prazo inválido limitada à
entrada vazia por sanitização do jsdom/browser, `tarefas.test.ts` usando
cliente Postgrest falso em vez de integração real) continuam valendo sem
mudança.
