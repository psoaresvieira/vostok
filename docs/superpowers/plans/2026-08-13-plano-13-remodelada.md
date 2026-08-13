# Plano 13 — Remodelada: Funil denso, trackeamento na frente, aba Disparo de WPP

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduzir a navegação a três abas (Funil, Métricas, Disparo de WPP), compactar o card do lead, pôr o trackeamento na frente das métricas, e dar à aba Disparo a biblioteca de scripts com preview formatado (sintaxe do WhatsApp) e envio direto pela aba.

**Architecture:** Zero mudança de banco. Um renderizador puro novo no domínio transforma segmentos interpolados em trechos com estilo; um componente de prévia compartilhado (paga o backlog do Plano 10) pinta esses trechos nos três previews. A aba `/disparo` embute a biblioteca atual e um fluxo de envio que reusa a Server Action `enviarWhatsApp` da ficha — nenhuma action de envio nova. Spec: `docs/superpowers/specs/2026-08-13-crm-remodelada-design.md`.

**Tech Stack:** Next.js 15 App Router, React 19, Vitest (unit em node, componente em jsdom), Playwright.

## Global Constraints

- **Forma assimétrica:** assinaturas e invariantes deste plano são normativos; corpos TypeScript são do implementador, sob TDD (RED demonstrado antes de cada implementação). Não há SQL neste plano.
- **Nada de banco:** nenhuma migration, nenhum grant, nenhuma RPC nova. Se uma task parecer precisar, é sinal de desvio da spec — parar e reportar.
- **Invariante do Plano 11 intocada:** texto salvo, `textoPlano`, tradução posicional, corpo enviado ao Graph e snapshot da timeline não passam pelo renderizador de formatação. O renderizador é leitura, nunca escrita.
- **Fail-safe do renderizador:** caso ambíguo fica **literal**. Na dúvida, o preview mostra o caractere cru.
- **Copiar continua saindo de `textoPlano`, nunca do DOM** (o sr-only da lacuna polui `textContent` — lição do Plano 10).
- **jsdom:** `afterEach(cleanup)` registrado à mão em todo `*.test.tsx` novo (o vitest deste repo não roda com `globals: true`).
- **Cada task termina com a suíte inteira verde** (unit + integração + E2E), typecheck e lint limpos — inclusive as tasks que mexem em navegação: os specs E2E afetados são atualizados **na mesma task** que quebra o caminho deles.
- **Supabase local:** só `npx supabase` (o binário não está no PATH). E2E exige nenhum `npm run dev` aberto.
- Comandos de teste: `npm test` · `npx vitest run --config vitest.integration.config.ts` · `npm run test:e2e` · `npm run typecheck` · `npm run lint`.
- Commits frequentes, mensagem em português, rodapé `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Renderizador de formatação do WhatsApp (domínio puro)

**Files:**
- Create: `src/lib/domain/whatsapp-formato.ts`
- Test: `src/lib/domain/whatsapp-formato.test.ts`

**Interfaces:**
- Consumes: `Segmento`, `Variavel` de `@/lib/domain/script` (tipos já existentes; ver `script.ts:12-16`), `textoPlano` para a invariante.
- Produces (normativo — Tasks 2, 3 e 7 dependem):

```ts
export type EstiloWhatsApp = 'negrito' | 'italico' | 'riscado' | 'mono'

export type TrechoFormatado =
  | { tipo: 'texto'; texto: string; estilos: EstiloWhatsApp[] }
  | { tipo: 'valor'; texto: string; nome: Variavel; estilos: EstiloWhatsApp[] }
  | { tipo: 'lacuna'; texto: string; nome: Variavel }
  | { tipo: 'desconhecida'; texto: string; nome: string }

/** Roda por cima do resultado de `interpolar` — nunca do texto salvo. */
export function formatarSegmentos(segs: Segmento[]): TrechoFormatado[]
```

**Regras normativas (da spec, seção 4):**
- Delimitadores: `*negrito*`, `_italico_`, `~riscado~`, ```` ```mono``` ````.
- Par abre e fecha **na mesma linha**; conteúdo não começa nem termina com espaço (regra do WhatsApp).
- Par não fechado, espaço encostado, cruzamento de linha: **literal** (trecho sem estilo).
- Aninhamento de **um nível** (`*_x_*` → miolo com `['negrito','italico']`); mais fundo fica literal.
- Dentro de ```` ```mono``` ```` os outros delimitadores não interpretam.
- **Os delimitadores continuam visíveis** no trecho (estilizados junto). Razão: sustenta a invariante abaixo e não mente sobre os bytes exatos do fio (decisão registrada na spec).
- Lacuna e desconhecida atravessam o renderizador **sem ganhar estilos** e sem quebrar par ao redor: os caracteres da tag (`{{nome}}`) contam como conteúdo para o par que a envolve, mas o trecho da lacuna sai sem `estilos`.

**INVARIANTE (caso de teste obrigatório):** para todo `segs`, `formatarSegmentos(segs).map((t) => t.texto).join('') === textoPlano(segs)` — a formatação reparticiona, nunca altera um byte.

- [ ] **Step 1: RED — casos de teste nomeados** (cada um afirma o descrito; para ficar vermelho, basta a função não existir ou devolver o texto sem partição):
  1. `*negrito*` numa linha só → três comportamentos válidos num assert: o texto completo aparece, o miolo tem estilo `negrito`, e a invariante fecha.
  2. `* negrito*` (espaço encostado no delimitador) → um trecho único sem estilos.
  3. `*aberto sem fechar` → literal, sem estilos.
  4. `*a\nb*` (par cruzando linha) → literal.
  5. `_italico_`, `~riscado~`, ```` ```mono``` ```` → cada um com seu estilo.
  6. ```` ```tem *asterisco* dentro``` ```` → mono, e o `*asterisco*` interno **sem** estilo negrito.
  7. `*_dois_*` → miolo com `['negrito','italico']`; `*_~tres~_*` (dois níveis) → literal.
  8. Composição com variável: `interpolar('*Olá {{primeiro_nome}}*', ctx)` com valor preenchido → o trecho do valor carrega `negrito`; com `primeiro_nome: null` → o trecho é `lacuna`, sem `estilos`, e o texto ao redor mantém o par.
  9. Texto sem delimitador nenhum → passthrough: um trecho por segmento, `estilos: []`, byte-idêntico.
  10. Invariante de concatenação rodada sobre **todos** os casos acima (asserção em cada caso ou varredura própria).
- [ ] **Step 2: rodar e ver RED** — `npx vitest run src/lib/domain/whatsapp-formato.test.ts`, falha por módulo inexistente.
- [ ] **Step 3: GREEN — implementar `formatarSegmentos`** sob as regras acima. Sugestão de estrutura (não normativa): varrer `textoPlano(segs)` com uma pilha de no máximo 2 estilos, mapear os intervalos de estilo de volta aos segmentos partindo texto/valor nas fronteiras.
- [ ] **Step 4: rodar e ver GREEN**; depois `npm test` inteiro.
- [ ] **Step 5: Commit** — `feat: renderizador puro da sintaxe do WhatsApp para preview`.

---

### Task 2: `<PreviaSegmentos>` compartilhado, formatado (paga backlog do Plano 10)

**Files:**
- Create: `src/app/(app)/scripts/previa.tsx`
- Test: `src/app/(app)/scripts/previa.test.tsx` (jsdom)
- Modify: o painter do editor em `src/app/(app)/scripts/editor.tsx` e o da ficha em `src/app/(app)/leads/[id]/scripts.tsx` — os dois passam a renderizar via `<PreviaSegmentos>`. **Antes de editar, ler os dois painters atuais** e preservar a semântica visual e de a11y de cada um.

**Interfaces:**
- Consumes: `formatarSegmentos`, `TrechoFormatado` (Task 1); `Segmento` de `@/lib/domain/script`.
- Produces (normativo — Task 7 usa):

```ts
export function PreviaSegmentos({ segmentos }: { segmentos: Segmento[] }): ReactElement
```

**Regras normativas:**
- Lacuna continua `<mark>` com o rótulo em `<span class="sr-only">` (aria-label em `<mark>` é name-prohibited — lição do Plano 10). A grafia exata do rótulo é a que os painters atuais usam — copiar dali, não inventar.
- Estilos: `negrito` → `font-bold`, `italico` → `italic`, `riscado` → `line-through`, `mono` → `font-mono` (classes Tailwind já usadas no repo).
- O componente NÃO recebe texto cru: só segmentos. Quem interpola é o chamador (uma interpolação por script — invariante da ficha).

- [ ] **Step 1: RED** — casos nomeados: (1) lacuna renderiza `<mark>` com sr-only idêntico ao atual; (2) `*negrito*` aparece com `font-bold` e os asteriscos visíveis; (3) valor preenchido dentro de par formatado herda o estilo; (4) `textContent` do preview contém o rótulo sr-only (documenta por que Copiar nunca lê o DOM).
- [ ] **Step 2: ver RED** (componente não existe).
- [ ] **Step 3: GREEN** — implementar `previa.tsx`; trocar os dois painters para usá-lo, sem mudar nenhum outro comportamento dos arquivos.
- [ ] **Step 4: `npm test` inteiro** — os testes existentes de editor e ficha são o guard de que a extração não regrediu nada; se algum quebrar, o defeito é da extração, não do teste.
- [ ] **Step 5: Commit** — `feat: previa compartilhada com formatacao do WhatsApp (paga backlog do Plano 10)`.

---

### Task 3: Toolbar B / I / riscado no editor

**Files:**
- Modify: `src/app/(app)/scripts/editor.tsx`
- Test: casos novos no teste jsdom que já cobre o editor (localizar por `editor` em `src/app/(app)/scripts/*.test.tsx`).

**Interfaces:**
- Consumes: o mecanismo de inserção no cursor que as variáveis clicáveis do editor já usam (ler o handler existente e reusar — não criar segundo caminho de inserção).
- Produces: três botões com nomes acessíveis exatos `Negrito`, `Itálico`, `Riscado`.

**Regras normativas:**
- Com seleção: envolve a seleção (`*seleção*`). Sem seleção: insere o par vazio e deixa o cursor entre os delimitadores.
- O preview ao vivo do editor (agora `<PreviaSegmentos>`) reflete o resultado — nenhum estado novo além do conteúdo que já existe.

- [ ] **Step 1: RED** — casos nomeados: (1) clicar `Negrito` com seleção envolve exatamente a seleção; (2) sem seleção insere `**` com cursor no meio (afirmar pelo valor do textarea e `selectionStart`); (3) os três botões existem por role/name.
- [ ] **Step 2: ver RED.**
- [ ] **Step 3: GREEN.**
- [ ] **Step 4: `npm test` inteiro.**
- [ ] **Step 5: Commit** — `feat: toolbar de formatacao no editor de scripts`.

---

### Task 4: Card compacto do funil

**Files:**
- Modify: `src/app/(app)/funil/cartao.tsx`
- Test: Create `src/app/(app)/funil/cartao.test.tsx` (jsdom — o card nunca teve teste próprio)

**Regras normativas (spec, seção 2 — encolher sem remover):**
- Linha 1: nome (link para `/leads/[id]`, `text-sm font-medium`).
- Linha 2: `flex justify-between text-xs` com valor, responsável (`sem responsável` quando nulo) e tempo parado.
- Etiquetas: linha própria só quando existem, chips `text-[10px] px-1 py-0`.
- Container: `p-2`; margens internas no máximo `mt-1`.
- Destaque de parado (`horas >= 72` → `text-destructive font-medium`) idêntico ao atual.

- [ ] **Step 1: RED** — casos nomeados: (1) nome, valor formatado, responsável e tempo presentes; (2) etiquetas renderizam quando existem e a `<ul>` não existe sem elas; (3) lead parado ≥72h tem a classe de destaque, <72h não; (4) o link aponta para `/leads/{id}`. (Para o caso 3 ficar vermelho de verdade: escrever contra o layout novo — `getByText` do valor na mesma linha do tempo — de modo que o arquivo atual falhe por estrutura.)
- [ ] **Step 2: ver RED** (estrutura atual tem valor e rodapé em linhas separadas).
- [ ] **Step 3: GREEN** — reescrever o JSX do card na forma acima.
- [ ] **Step 4: `npm test` + `npm run test:e2e`** (o E2E do funil arrasta cards — provar que o drag não regrediu).
- [ ] **Step 5: Commit** — `feat: card compacto no funil — mesmos dados, metade da altura`.

---

### Task 5: Métricas com o trackeamento na frente

**Files:**
- Modify: `src/app/(app)/metricas/page.tsx:105-112` (ordem de render: `<Canais>` antes de `<Funil>` e `<Etiquetas>`)
- Modify: `tests/e2e/metricas.spec.ts` — asserção de ordem no DOM.

**Regras normativas:** só a ordem muda — Canais, depois Funil, depois Etiquetas. Filtros continuam acima; empty state único continua.

- [ ] **Step 1: RED** — no spec E2E de métricas, caso novo: o heading da visão de canais precede o do funil no DOM (comparar posições via `locator` + `boundingBox` ou ordem de `getByRole('heading')`). Ver RED contra a página atual.
- [ ] **Step 2: GREEN** — trocar a ordem dos três componentes no JSX.
- [ ] **Step 3: `npm run test:e2e`** e suíte inteira.
- [ ] **Step 4: Commit** — `feat: trackeamento abre as metricas`.

---

### Task 6: Página `/disparo` com a biblioteca embutida + redirect de `/scripts`

**Files:**
- Create: `src/app/(app)/disparo/page.tsx`
- Modify: `src/app/(app)/scripts/page.tsx` → vira só `redirect('/disparo')` (import de `next/navigation`; nenhuma outra linha).
- Modify: breadcrumbs `Voltar`/links em `src/app/(app)/scripts/novo/page.tsx:25` e `src/app/(app)/scripts/[id]/page.tsx:67` → apontam para `/disparo`.
- Modify: `src/app/(app)/leads/[id]/scripts.tsx:388` (link `/scripts` da ficha) → `/disparo`.
- Modify: `tests/e2e/scripts.spec.ts` — navegações que esperam URL `/scripts` passam a esperar `/disparo` (a lista); navegações para `/scripts/novo` e `/scripts/[id]` ficam.

**Interfaces:**
- Consumes: o corpo atual de `scripts/page.tsx` (carregamento via `criarScriptStoreDoServidor` + `dosScripts` + a lista com busca) — **move-se para `/disparo/page.tsx`**, não se reescreve. A Task 7 adiciona a área Disparar por cima.
- Produces: rota `/disparo` renderizando a biblioteca idêntica à lista atual (título da página pode dizer `Disparo de WhatsApp`); `/scripts` redireciona.

- [ ] **Step 1: RED** — no spec E2E de scripts, caso novo: visitar `/scripts` termina em `/disparo` com a biblioteca visível. Ver RED (rota `/disparo` não existe → 404).
- [ ] **Step 2: GREEN** — mover o conteúdo, criar o redirect, atualizar breadcrumbs e os asserts de URL do spec.
- [ ] **Step 3: suíte inteira** (`npm test`, integração, E2E).
- [ ] **Step 4: Commit** — `feat: /disparo nasce com a biblioteca; /scripts redireciona`.

---

### Task 7: Fluxo Disparar na aba

**Files:**
- Create: `src/app/(app)/disparo/acoes.ts` (Server Action de busca de lead)
- Create: `src/app/(app)/disparo/disparar.tsx` (client component) + `disparar.test.tsx` (jsdom)
- Test: `src/app/(app)/disparo/acoes.test.ts` (unit, stores mockados — forma de `scripts/acoes.test.ts`)
- Modify: `src/app/(app)/disparo/page.tsx` — área Disparar acima da biblioteca, alimentada no servidor com scripts + templates + mapas de nome (etapa/pessoa).

**Interfaces:**
- Consumes: `enviarWhatsApp(leadId, scriptId)` de `src/app/(app)/leads/[id]/acoes-whatsapp.ts` (Server Action existente — **nenhuma action de envio nova**; todas as guardas do Plano 11 vêm com ela); `interpolar`, `contarPendencias`, `contextoDoLead` de `@/lib/domain/script`; `estaDesatualizado` de `@/app/(app)/scripts/desatualizado`; `<PreviaSegmentos>` (Task 2); `listarLeads({ busca })` do `CrmStore`; `mensagemDeErroScript` de `@/app/(app)/scripts/erros`.
- Produces (normativo):

```ts
// acoes.ts
export type LeadParaDisparo = {
  id: string
  nome: string
  telefoneE164: string | null
  etapa: string | null
  /** Pronto para interpolar — montado no servidor com contextoDoLead. */
  contexto: ContextoScript
}
export async function buscarLeadsParaDisparo(
  termo: string,
): Promise<Resultado<LeadParaDisparo[]>>
```

**Regras normativas:**
- `buscarLeadsParaDisparo`: sessão via `criarStoreDoServidor`; `listarLeads({ busca: termo })` (o escape de `%` já mora no store); montar `contexto` com `contextoDoLead(lead, nomeEtapa, nomePessoa)` (mapas de `pipelinePadrao` + `membros`); limitar a 10 resultados; termo em branco → `ok([])` sem consulta. A RLS recorta — vendedor só encontra os leads dele, e **não há teste novo de RLS aqui**: a garantia é a mesma da tela de funil.
- `disparar.tsx` (client, actions por prop com default — padrão de `template-whatsapp.tsx`):
  - Passo 1 — escolher script: recebe do servidor a lista com template e `desatualizado` por script; só aprovado+atualizado é selecionável; os demais desabilitados com o motivo nas frases de `mensagemDeErroScript` (`sem template` usa texto próprio: `Sem template — submeta no editor`) e link para `/scripts/[id]`.
  - Passo 2 — buscar lead: input + resultados da action; lead com `telefoneE164 === null` desabilitado com motivo.
  - Passo 3 — preview `<PreviaSegmentos>` da interpolação `interpolar(script.conteudo, lead.contexto)`; lacuna (`contarPendencias(...).lacunas > 0`) **bloqueia o envio** com a frase de `whatsapp_lacunas` (mesma decisão da ficha).
  - Enviar: trava síncrona por `useRef` (copiar o padrão comentado de `leads/[id]/scripts.tsx:57-64` — duas mensagens cobradas é o risco), `Enviado ✓` transitório com link `Ver na ficha` → `/leads/[id]`, erro da action pela `mensagemDeErroScript`.
- A página passa `agora`/dados do servidor; nenhum relógio dentro de componente (lição de `template-whatsapp.tsx:84-89`).

- [ ] **Step 1: RED da action** — casos nomeados: (1) termo em branco devolve `ok([])` e `listarLeads` não é chamado; (2) caminho feliz devolve os campos e o `contexto` montado (mapas aplicados); (3) falha do store propaga; (4) corte em 10.
- [ ] **Step 2: ver RED; GREEN da action; `npm test`.**
- [ ] **Step 3: RED do componente** — casos nomeados: (1) script recusado/desatualizado/sem template aparecem desabilitados com o motivo, aprovado é selecionável; (2) lead sem telefone desabilitado; (3) preview interpola com o contexto do lead escolhido e lacuna bloqueia com a frase certa; (4) enviar chama a action com `(leadId, scriptId)` exatos; (5) dois cliques no mesmo frame disparam UMA chamada (provar pelo stub registrando); (6) erro da action aparece; (7) sucesso mostra `Enviado ✓` e o link para a ficha.
- [ ] **Step 4: ver RED; GREEN do componente + fiação na página; `npm test`.**
- [ ] **Step 5: suíte inteira.**
- [ ] **Step 6: Commit** — `feat: disparo de WhatsApp pela aba — script, lead, preview e envio sem abrir a ficha`.

---

### Task 8: Navegação nova

**Files:**
- Modify: `src/app/(app)/layout.tsx` — links do topo viram `Funil` · `Métricas` · `Disparo de WPP` (`/disparo`); o link e o badge de Tarefas saem, junto com a chamada a `contarUrgentes`/consulta de urgentes do layout (ela só existia para o badge — conferir que nada mais a usa antes de remover); `Configuração` vira ícone de engrenagem (SVG inline, `aria-label="Configuração"`, admin only) ao lado do sino.
- Modify: specs E2E que navegam pelos links antigos do topo — `tests/e2e/tarefas.spec.ts` (navegar por URL `/tarefas` direto), `tests/e2e/scripts.spec.ts` e `tests/e2e/disparo-whatsapp.spec.ts` (link `Disparo de WPP`), demais specs que cliquem em `Configuração` (usar o ícone pelo aria-label).

**Regras normativas:**
- Rota `/tarefas` continua viva e funcional — só o link sai.
- O comentário longo sobre `<a>` vs `<Link>` em `layout.tsx:111-124` vale para o link novo de `/disparo` se `/disparo/[algo]` um dia existir; hoje `/disparo` não tem rota dinâmica irmã, então `<a>` simples como os vizinhos.

- [ ] **Step 1: RED** — caso E2E novo (spec de navegação ou no de funil): o topo tem exatamente os três links, `Tarefas` e `Scripts` ausentes por role/name, engrenagem visível para admin e ausente para vendedor. Ver RED contra o layout atual.
- [ ] **Step 2: GREEN** — layout novo + atualização mecânica dos specs listados.
- [ ] **Step 3: suíte inteira** (E2E completo — é a task de maior churn).
- [ ] **Step 4: Commit** — `feat: navegacao em tres abas — Funil, Metricas, Disparo de WPP`.

---

### Task 9: E2E do disparo pela aba + portão final da branch

**Files:**
- Modify: `tests/e2e/disparo-whatsapp.spec.ts` (ou spec novo `tests/e2e/disparo-pela-aba.spec.ts`) — smoke ponta a ponta pela aba, com o Graph falso e as fixtures que o spec de disparo já monta.

**Caso nomeado:** admin abre `/disparo`, escolhe o script com template aprovado, busca o lead pelo nome, vê o preview com o valor interpolado, envia, vê `Enviado ✓`, abre `Ver na ficha` e a timeline mostra `whatsapp_enviado` com o texto exato. O que tem que quebrar para ficar vermelho: qualquer elo do fluxo (busca, preview, action, evento).

- [ ] **Step 1: escrever o caso e ver RED** se a Task 7 tiver deixado qualquer elo solto (se nascer verde, validar por mutação rápida: desabilitar o botão de enviar e ver o caso falhar; reverter).
- [ ] **Step 2: portão final** — `npm run db:reset` e, no resultado: `npm test`, integração, `npm run test:e2e`, `npm run typecheck`, `npm run lint`, `npm run build`. Tudo verde.
- [ ] **Step 3: Commit** — `test: smoke E2E do disparo pela aba`.

---

## Self-review do plano (feito na escrita)

- **Cobertura da spec:** §1 navegação → Tasks 6/8; §2 card → Task 4; §3 métricas → Task 5; §4 formatação+toolbar → Tasks 1/2/3; §5 aba → Tasks 6/7/9; §6 "não muda" → Global Constraints; §7 testes → distribuídos + portão na Task 9; §8 riscos → churn E2E confinado às Tasks 5/6/8/9.
- **Placeholders:** nenhum TBD/TODO; todo caso de teste diz o que afirma e o que o deixa vermelho.
- **Consistência de tipos:** `TrechoFormatado`/`formatarSegmentos` (Task 1) são os consumidos nas Tasks 2 e 7; `PreviaSegmentos({ segmentos })` idem; `LeadParaDisparo.contexto: ContextoScript` casa com `interpolar(conteudo, ctx)`; `enviarWhatsApp(leadId, scriptId)` confere com `leads/[id]/scripts.tsx:28`.
