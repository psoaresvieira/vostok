# Remodelada da navegação: Funil denso, Métricas com trackeamento na frente, aba Disparo de WPP

**Data:** 2026-08-13 · **Status:** aprovada pelo Pedro (conversa de 2026-08-13)

## O pedido

Pedro quer o produto reduzido a três abas: **Funil** (com o card do lead menor,
para caber mais leads por coluna), **Métricas** (com o trackeamento em
destaque) e **Disparo de WPP** (a casa dos scripts, com editor estilo
markdown e envio direto pela aba). A integração real com Meta/WhatsApp
(tokens, painel) fica fora do escopo — o Pedro fará manualmente.

Nota de história: o Plano 12 ("essencial fica") foi cancelado em 2026-08-04 e
esta spec NÃO o ressuscita — é um pedido novo, com escopo próprio e menor.
Nada desta spec depende daquele brainstorm.

## Decisões fechadas (com o Pedro, 2026-08-13)

| Decisão | Escolha |
|---|---|
| Abas do topo | Funil · Métricas · Disparo de WPP |
| Tarefas | Sai do topo (aba e badge); painel na ficha do lead continua; rota `/tarefas` segue viva, só deslistada |
| Configuração | Ícone de engrenagem discreto à direita (junto ao sino), admin only |
| Card do funil | **Encolher sem remover**: mesmos dados, padding/fontes/margens menores |
| Métricas | Só reordenar: Canais (trackeamento) primeiro; visões e cálculos intocados |
| Scripts | Biblioteca embutida na aba Disparo; editor continua em `/scripts/novo` e `/scripts/[id]` |
| Formato dos scripts | **Sintaxe do próprio WhatsApp** (`*negrito*`, `_itálico_`, `~riscado~`, ```` ```mono``` ````), renderizada no preview; o texto salvo/enviado não muda |
| Envio pela aba | Sim: escolher script → buscar lead → preview → enviar, reusando a action da ficha |

## 1. Navegação e rotas

**Topo:** `Funil` · `Métricas` · `Disparo de WPP`, mais o sino, a engrenagem
(admin) e Sair. O link e o badge de Tarefas saem; a consulta de urgentes
(`contarUrgentes` no layout) sai junto — era só para o badge.

**Rotas:**

- `/disparo` — nova, a aba de Disparo (seção 5).
- `/scripts` (lista) — vira `redirect('/disparo')` permanente. Bookmarks e
  E2E antigos continuam chegando ao lugar certo.
- `/scripts/novo` e `/scripts/[id]` — continuam onde estão; breadcrumbs
  passam a apontar para `/disparo`.
- `/tarefas` e `/config` — continuam existindo e funcionando; só saem do topo
  (`/config` ganha o ícone).

Nada é excluído: a remodelada é de navegação e densidade, não de remoção de
capacidade. Reverter é re-listar links.

## 2. Card do funil (densidade)

`funil/cartao.tsx` mantém **todos** os dados de hoje — nome (link para a
ficha), valor, etiquetas, responsável, tempo parado — em menos pixels:

- `p-3` → `p-2`; margens internas `mt-1`/`mt-2` → `mt-0.5`/`mt-1`.
- Nome em `text-sm`.
- **Valor + responsável + tempo parado numa linha só** (`text-xs`,
  `justify-between`); hoje valor e o rodapé são linhas separadas.
- Etiquetas em chips menores (`text-[10px]`, `px-1`, `py-0`); a linha só
  existe quando há etiqueta (como hoje).
- O destaque de parado (`>= 72h` em vermelho) continua idêntico.

Alvo: card sem etiquetas cai de 3 blocos empilhados para 2 linhas —
aproximadamente 35–40% menos altura, ou seja, de ~5 para ~8 cards visíveis
por coluna em 1080p. Sem mudança de dados, de drag-and-drop, de filtros ou de colunas.

## 3. Métricas (trackeamento na frente)

Em `metricas/page.tsx`, a ordem de renderização vira **Canais → Funil →
Etiquetas** (hoje é Funil → Etiquetas → Canais). Filtros continuam no topo.
Nenhuma visão, cálculo, RPC ou filtro muda. O empty state (nenhum lead no
período) continua único para a página.

## 4. Formatação do WhatsApp no preview

**Função pura nova no domínio** (`lib/domain/whatsapp-formato.ts`):
transforma um texto em segmentos de formatação para o preview renderizar
(`negrito`/`itálico`/`riscado`/`mono`/`texto`), com as regras do WhatsApp:

- Delimitadores: `*b*`, `_i_`, `~s~`, ```` ```mono``` ````.
- Par abre/fecha **na mesma linha**; o conteúdo não começa nem termina com
  espaço (regra do próprio WhatsApp).
- Caso ambíguo ou par não fechado fica **literal** — o preview nunca mostra
  formatação que o WhatsApp não faria. Fail-safe na direção certa: na dúvida,
  mostra o caractere cru.
- Aninhamento de **um nível** (`*_negrito itálico_*`) é suportado; mais fundo
  que isso fica literal.

**Onde o renderizador NÃO entra:** no texto salvo, no `textoPlano`, na
tradução posicional, no corpo enviado ao Graph e no snapshot da timeline.
A invariante do Plano 11 — o que o Meta manda é byte-idêntico ao preview em
texto plano — continua intacta porque a formatação é interpretação de leitura,
não transformação de escrita. O WhatsApp do destinatário é quem renderiza a
sintaxe no telefone; o nosso preview passa a fazer o mesmo, e só isso.

**Composição com variáveis:** o renderizador roda por cima dos segmentos que
`interpolar` já produz — variável preenchida formata junto do texto ao redor;
lacuna (`{{nome}}` literal com `<mark>`) continua aparecendo como lacuna, sem
formatação por dentro.

**Toolbar no editor:** botões B / I / riscado em `/scripts/novo` e
`/scripts/[id]` que inserem a sintaxe em volta da seleção (ou no cursor),
pelo mesmo mecanismo das variáveis clicáveis que o editor já tem. Preview do
editor, painel da ficha e preview do disparo (seção 5) passam a renderizar
formatado.

## 5. Aba Disparo de WPP (`/disparo`)

Uma página, duas áreas:

### 5a. Disparar

Fluxo em três passos na própria aba, sem abrir a ficha:

1. **Escolher o script.** Lista os scripts da conta com o estado de template
   de cada um (o `dosScripts` + `estaDesatualizado` que a biblioteca já usa).
   Só script com template **aprovado e atualizado** é selecionável para
   envio; os demais aparecem desabilitados com o motivo ("sem template",
   "em análise", "recusado", "desatualizado") e link para o editor.
2. **Buscar o lead.** Campo de busca por nome usando `listarLeads` com o
   filtro `busca` que já existe (escape de `%` incluído). A RLS recorta:
   vendedor só encontra os leads dele. Resultado mostra nome, telefone e
   etapa; lead sem telefone aparece desabilitado com o motivo.
3. **Preview e envio.** Preview interpolado com `contextoDoLead` (formatação
   da seção 4 renderizada), e o botão Enviar chama **a mesma Server Action
   de envio da ficha** — nenhuma action nova de envio. Todas as guardas do
   Plano 11 valem por construção: lacuna bloqueia, telefone ausente bloqueia,
   template desatualizado bloqueia, trava síncrona de duplo clique, evento
   `whatsapp_enviado` na timeline com snapshot do texto.

Depois do envio: confirmação na própria aba com link para a ficha do lead
(onde a timeline registrou).

### 5b. Biblioteca

O conteúdo da lista `/scripts` atual embutido: busca, "Novo script"
(admin/gestor), cards com título/etapa/preview. Os cliques levam ao editor
(`/scripts/[id]`), que não muda de lugar. O bloco de template do Meta
(submissão, status, excluir) continua no editor.

**Papéis:** os três papéis disparam (como na ficha); escrita de script e
gestão de template continuam admin/gestor; `/scripts/novo` continua
`notFound()` para vendedor.

## 6. O que NÃO muda

- Motor de envio, tradução posicional, templates, RPCs, migrations: zero
  mudança de banco nesta remodelada.
- Painel de tarefas na ficha do lead, tela `/tarefas`, tela `/config`.
- Ficha do lead inteira (o painel de scripts dela ganha só o preview
  formatado).
- Kanban: colunas, drag-and-drop, filtros, novo lead, modal de perda.

## 7. Testes

- **Unit (domínio):** o renderizador de formatação — pares na mesma linha,
  espaço encostado invalida, não fechado fica literal, aninhamento simples,
  composição com segmentos de variável e lacuna.
- **Component (jsdom):** card compacto (todos os dados continuam presentes);
  ordem das seções de métricas; toolbar inserindo sintaxe; fluxo do disparo
  (script desabilitado com motivo, lead sem telefone desabilitado, preview
  interpolado, erro da action na tela).
- **E2E:** navegação nova (três links; Tarefas/Scripts ausentes; engrenagem
  para admin), redirect `/scripts` → `/disparo`, smoke do disparo pela aba
  (com o Graph falso), e atualização dos specs existentes que navegam pelos
  links antigos do topo.
- **Portões de sempre:** typecheck, lint, build, suíte completa no resultado
  do merge.

## 8. Riscos e mitigação

- **Churn de E2E** (specs navegam por "Scripts" e "Tarefas" no topo): é o
  maior custo da mudança; mitigado por ser mecânico e pelos redirects.
- **Renderizador de formatação mentindo no preview:** mitigado pela regra
  fail-safe (ambíguo fica literal) e pelos casos de teste nomeados; o texto
  no fio não passa por ele, então o pior caso é estético, nunca de envio.
- **Envio pela aba sem contexto da ficha:** o preview interpolado + a
  confirmação com link para a timeline dão o contexto mínimo; as guardas
  existentes impedem envio inválido. Histórico de disparos na aba ficou
  explicitamente fora (era a Abordagem C, recusada por escopo).
