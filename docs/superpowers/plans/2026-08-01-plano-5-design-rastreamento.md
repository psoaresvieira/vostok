# Plano 5 — Sistema de design + Rastreamento de origem

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O CRM passa a ter a identidade visual do gestor-tráfego, e todo lead novo do Meta e do Google chega carregando campanha, conjunto e **anúncio** de origem, em pares id/nome.

**Architecture:** Duas frentes independentes num plano só porque nenhuma sustenta um plano sozinha. A primeira porta a camada de tokens do gestor-tráfego e converte as telas existentes, com um **portão mecânico** (teste que varre `src/`) garantindo completude sem teste de componente. A segunda troca as duas colunas de texto ambíguas de `leads` por oito colunas em pares id/nome, usando **expand/contract**: o TypeScript passa a emitir as chaves novas *antes* de a migration trocar as colunas, e só depois as antigas saem — assim toda tarefa termina com a suíte inteira verde, E2E incluído.

**Tech Stack:** Next.js 15 (App Router) + React 19 + TypeScript + Tailwind v4 + Supabase (Postgres/RLS) + vitest + Playwright.

## Global Constraints

- **Nenhuma dependência nova.** Nem shadcn, nem base-ui, nem tw-animate-css, nem biblioteca de gráfico. `package.json` não muda neste plano.
- **`npx supabase`, nunca `supabase`** — o binário não está no PATH desta máquina.
- **Toda função Postgres nova precisa de `grant execute` explícito para `authenticated`**: o default ACL do schema `public` nesta imagem (Postgres 17.6) concede a `anon`/`authenticated` apenas `Dxtm`.
- **Nomes e comentários em português**, seguindo o repo. Comentário explica *por quê*, não *o quê*.
- **Todo acesso a dados devolve `Resultado<T>`** (`src/lib/domain/resultado.ts`). Domínio é puro, sem IO.
- **Nenhuma contagem de teste aparece neste plano.** É fato derivado que envelhece; foi corrigido quatro vezes no Plano 3. O portão é "suíte verde e todo teste novo com RED demonstrado".
- **Antes de rodar E2E:** derrube qualquer `npm run dev` aberto — o `reuseExistingServer` do Playwright se conecta a um servidor que subiu sem `META_FAKE` e os testes tentam alcançar o Graph de verdade. A suíte roda com `workers: 1` de propósito.
- **Se um teste que deveria falhar passar, pare e investigue.** Não afrouxe a asserção. Isso achou bug três vezes no sub-projeto 1.
- Comandos: `npm test` (unitário) · `npm run test:integration` (exige Docker + `npx supabase start`) · `npm run test:e2e` · `npm run typecheck` · `npm run lint`.

---

## Estrutura de arquivos

**Criados**
- `src/lib/ui/estilo.test.ts` — o portão mecânico de estilo.

**Modificados**
- `src/app/globals.css` — substituído inteiro pela camada de tokens.
- `src/app/layout.tsx` — fontes Inter + Space Grotesk.
- 18 arquivos `.tsx` sob `src/app/` — conversão de classe crua para token.
- `src/lib/integracoes/meta.ts` — o tipo `ArvoreDeAnuncio` e o método novo no port.
- `src/lib/integracoes/meta-real.ts` / `meta-falso.ts` — as duas implementações.
- `src/lib/ingestao/dados.ts` — `DadosDoLead` e `paraPayload`.
- `src/lib/ingestao/mapear-meta.ts` / `mapear-google.ts` — produção dos campos novos.
- `src/lib/ingestao/processar.ts` — a ordem best-effort.
- `supabase/migrations/0013_rastreamento.sql` — criado; colunas e `ingerir_lead`.
- Os `.test.ts` vizinhos de cada arquivo acima, mais `tests/integration/0011_ingerir_lead.test.ts`.

---

### Task 1: Camada de tokens e fontes

**Files:**
- Modify: `src/app/globals.css` (substituição integral)
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: nada.
- Produces: as classes utilitárias de token que a Task 2 consome — `bg-background`, `bg-card`, `bg-muted`, `bg-secondary`, `bg-primary`, `bg-destructive`, `bg-warning`, `text-foreground`, `text-muted-foreground`, `text-primary-foreground`, `text-destructive`, `text-warning`, `border-border` — e as utilitárias `.tabular`, `.eyebrow`, `.surface`, `.accent-top`, `.fade-in`.

- [ ] **Step 1: Substituir `src/app/globals.css` inteiro**

Os `@import "shadcn/tailwind.css"` e `@import "tw-animate-css"` do original **não entram**: nada aqui depende deles, e adicioná-los violaria a constraint de zero dependência nova.

`--warning` é a única adição sobre o arquivo do gestor-tráfego. Ele reusa a cor de `--chart-4`, e existe porque as telas do CRM têm caixas de aviso (`bg-amber-50` em `novo-lead.tsx` e `integracoes.tsx`) que na Task 2 precisam de um token para onde ir.

```css
@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

@theme inline {
    --font-heading: var(--font-display);
    --font-sans: var(--font-sans);
    --color-chart-5: var(--chart-5);
    --color-chart-4: var(--chart-4);
    --color-chart-3: var(--chart-3);
    --color-chart-2: var(--chart-2);
    --color-chart-1: var(--chart-1);
    --color-ring: var(--ring);
    --color-input: var(--input);
    --color-border: var(--border);
    --color-destructive: var(--destructive);
    --color-warning: var(--warning);
    --color-success: var(--success);
    --color-accent-foreground: var(--accent-foreground);
    --color-accent: var(--accent);
    --color-muted-foreground: var(--muted-foreground);
    --color-muted: var(--muted);
    --color-secondary-foreground: var(--secondary-foreground);
    --color-secondary: var(--secondary);
    --color-primary-foreground: var(--primary-foreground);
    --color-primary: var(--primary);
    --color-popover-foreground: var(--popover-foreground);
    --color-popover: var(--popover);
    --color-card-foreground: var(--card-foreground);
    --color-card: var(--card);
    --color-foreground: var(--foreground);
    --color-background: var(--background);
    --radius-sm: calc(var(--radius) * 0.6);
    --radius-md: calc(var(--radius) * 0.8);
    --radius-lg: var(--radius);
    --radius-xl: calc(var(--radius) * 1.4);
    --radius-2xl: calc(var(--radius) * 1.8);
    --radius-3xl: calc(var(--radius) * 2.2);
    --radius-4xl: calc(var(--radius) * 2.6);
}

/* Os tokens --sidebar-* do gestor-trafego NAO foram portados: o CRM nao tem
   sidebar, e token sem consumidor vira ruido que o proximo leitor tenta
   descobrir onde e usado. Se uma sidebar existir um dia, copie-os de la. */

/*
  Paleta "sala de operação", portada do gestor-trafego: navy quase-preto,
  superficies em navy elevado, texto branco-frio, e um unico azul de acento
  para dados e acoes. O tema e escuro por padrao: :root e .dark carregam os
  mesmos tokens, entao nao ha modo claro para manter em paralelo.
*/
:root {
    --background: #070b16;
    --foreground: #eaf0fb;
    --card: #0e1526;
    --card-foreground: #eaf0fb;
    --popover: #0e1526;
    --popover-foreground: #eaf0fb;
    --primary: #3d7bff;
    --primary-foreground: #ffffff;
    --secondary: #17223c;
    --secondary-foreground: #eaf0fb;
    --muted: #131d33;
    --muted-foreground: #8496b8;
    --accent: #182642;
    --accent-foreground: #eaf0fb;
    --destructive: #f2637e;
    --success: #35d0a5;
    /* Mesma cor de --chart-4. Existe como token proprio porque "aviso" e um
       papel semantico, e caixa de aviso nao deve referenciar um slot de
       grafico pelo nome. */
    --warning: #f2b263;
    --border: #1c2942;
    --input: #1c2942;
    --ring: #3d7bff;
    --chart-1: #3d7bff;
    --chart-2: #35d0a5;
    --chart-3: #7aa2ff;
    --chart-4: #f2b263;
    --chart-5: #a78bfa;
    --radius: 0.75rem;
}

.dark {
    --background: #070b16;
    --foreground: #eaf0fb;
    --card: #0e1526;
    --card-foreground: #eaf0fb;
    --popover: #0e1526;
    --popover-foreground: #eaf0fb;
    --primary: #3d7bff;
    --primary-foreground: #ffffff;
    --secondary: #17223c;
    --secondary-foreground: #eaf0fb;
    --muted: #131d33;
    --muted-foreground: #8496b8;
    --accent: #182642;
    --accent-foreground: #eaf0fb;
    --destructive: #f2637e;
    --success: #35d0a5;
    --warning: #f2b263;
    --border: #1c2942;
    --input: #1c2942;
    --ring: #3d7bff;
    --chart-1: #3d7bff;
    --chart-2: #35d0a5;
    --chart-3: #7aa2ff;
    --chart-4: #f2b263;
    --chart-5: #a78bfa;
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
    /* Assinatura: leve brilho azul no topo, sobre o navy quase-preto. */
    background-image:
      radial-gradient(1100px 520px at 50% -12%, color-mix(in oklch, var(--primary) 16%, transparent), transparent 62%);
    background-attachment: fixed;
  }
  html {
    @apply font-sans;
    -webkit-font-smoothing: antialiased;
  }
  /* Numeros de metrica alinhados em colunas. */
  .tabular {
    font-variant-numeric: tabular-nums;
    font-feature-settings: "tnum" 1, "ss01" 1;
  }
}

@layer utilities {
  /* Etiqueta pequena em maiusculas — "eyebrow" dos cards de metrica. */
  .eyebrow {
    font-size: 0.6875rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted-foreground);
    font-weight: 600;
  }
  /* Cartao de vidro: superficie navy com hairline e leve profundidade. */
  .surface {
    background: linear-gradient(180deg, color-mix(in oklch, var(--card) 100%, white 2%), var(--card));
    border: 1px solid var(--border);
    box-shadow: 0 1px 0 0 rgb(255 255 255 / 0.03) inset, 0 20px 40px -24px rgb(0 0 0 / 0.6);
  }
  /* Filete de acento no topo de um card em destaque. */
  .accent-top {
    position: relative;
  }
  .accent-top::before {
    content: "";
    position: absolute;
    inset: 0 0 auto 0;
    height: 2px;
    border-radius: 999px;
    background: linear-gradient(90deg, transparent, var(--primary), transparent);
    opacity: 0.7;
  }
  .fade-in {
    animation: fade-in 0.5s ease both;
  }
  @keyframes fade-in {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .fade-in { animation: none; }
  }
}
```

- [ ] **Step 2: Trocar as fontes em `src/app/layout.tsx`**

Geist sai; entram Inter (`--font-sans`) e Space Grotesk (`--font-display`), que é o par do gestor-tráfego. `next/font/google` já é do Next — nenhuma dependência nova. `lang` passa a `pt-BR`, e o título deixa de ser o do `create-next-app`.

```tsx
import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "CRM",
  description: "CRM para negocios que rodam trafego pago",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className={`${inter.variable} ${spaceGrotesk.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Verificar que o build compila e a suíte não regrediu**

Run: `npm run typecheck && npm run lint && npm run build && npm test`
Expected: os quatro passam. Nenhum teste unitário toca CSS, então uma falha aqui é erro de sintaxe no `globals.css` ou import quebrado no layout.

- [ ] **Step 4: Conferir com o olho, uma vez**

Run: `npm run dev` e abra `/login`.
Expected: fundo navy escuro com brilho azul no topo, texto claro. Os campos e botões ainda estarão com cores cruas do Tailwind — isso é esperado, a Task 2 os converte. O que este passo verifica é só que os tokens **carregaram**: se a página vier branca, o `globals.css` não está sendo aplicado e nada da Task 2 vai funcionar.

Derrube o `npm run dev` antes de seguir.

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css src/app/layout.tsx
git commit -m "feat: porta a camada de tokens do gestor-trafego, sem dependencia nova"
```

---

### Task 2: Portão mecânico de estilo e conversão das telas

**Files:**
- Create: `src/lib/ui/estilo.test.ts`
- Modify: os 18 `.tsx` listados no Step 3

**Interfaces:**
- Consumes: os tokens da Task 1.
- Produces: a garantia, verificada por teste, de que nenhuma classe de paleta crua sobrevive em `src/`. Nenhuma tarefa posterior depende de símbolo daqui.

O repo **não tem infraestrutura de teste de componente** — `vitest.config.ts` é `environment: 'node'` com `include: ['src/**/*.test.ts']`, então `.tsx` nem é coletado. Este portão não substitui isso: ele prova **completude** da conversão, não correção visual. Regressão de silhueta, espaçamento e feedback de arrastar continua coberta só pelos specs E2E e pelo olho. Risco aceito e registrado na spec §5.3.

- [ ] **Step 1: Escrever o portão**

Ele mora sob `src/` porque é a única árvore que o `vitest.config.ts` coleta.

```ts
// src/lib/ui/estilo.test.ts
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = path.resolve(__dirname, '..', '..')

// Depois do porte dos tokens, cor no CRM vem de token semantico (bg-card,
// text-muted-foreground, ...). A escala numerica do Tailwind ignora o tema:
// um text-gray-600 chumbado fica ilegivel sobre o fundo navy, e o sintoma so
// aparece para quem abrir aquela tela. Este portao existe porque o repo nao
// tem teste de componente para pegar isso de outro jeito.
const PREFIXOS = 'bg|text|border|ring|fill|stroke|from|via|to|divide|outline|accent|caret|shadow'
const ESCALAS =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'

const PADROES: RegExp[] = [
  new RegExp(`\\b(?:${PREFIXOS})-(?:${ESCALAS})-\\d{2,3}\\b`, 'g'),
  /\b(?:bg|text|border|ring|fill|stroke)-white\b/g,
  /\b(?:text|border|ring|fill|stroke)-black\b/g,
  // `bg-black/40` e scrim de modal, nao cor de paleta: um veu continua preto
  // no tema escuro, e trocar por bg-foreground/40 o pintaria de branco. O
  // lookahead libera SO a forma com opacidade — `bg-black` puro continua
  // barrado, porque ali ele e cor de botao.
  /\bbg-black\b(?!\/)/g,
]

function arquivosDeTela(dir: string): string[] {
  const achados: string[] = []
  for (const entrada of readdirSync(dir)) {
    const caminho = path.join(dir, entrada)
    if (statSync(caminho).isDirectory()) {
      achados.push(...arquivosDeTela(caminho))
    } else if (entrada.endsWith('.tsx')) {
      achados.push(caminho)
    }
  }
  return achados
}

describe('portao de estilo', () => {
  it('nenhum .tsx em src/ usa classe de paleta crua do Tailwind', () => {
    const violacoes: string[] = []

    for (const arquivo of arquivosDeTela(SRC)) {
      const conteudo = readFileSync(arquivo, 'utf8')
      const linhas = conteudo.split('\n')
      linhas.forEach((linha, i) => {
        for (const padrao of PADROES) {
          for (const achado of linha.matchAll(padrao)) {
            violacoes.push(`${path.relative(SRC, arquivo)}:${i + 1}  ${achado[0]}`)
          }
        }
      })
    }

    // Mensagem com a lista inteira, e nao so a contagem: quem roda isto
    // vermelho precisa da lista para converter, e uma contagem obrigaria a
    // rodar um grep a mais para descobrir onde.
    expect(violacoes, `classes cruas encontradas:\n${violacoes.join('\n')}`).toEqual([])
  })

  it('o portao de fato reconhece uma classe crua', () => {
    // Sem este caso, um erro na regex (grupo trocado, escape errado) deixaria
    // o teste acima verde para sempre, e ele pareceria estar protegendo o
    // repo enquanto nao olha para nada. Discriminacao provada aqui, no lugar
    // de assumida.
    const amostra = 'className="bg-white text-gray-600 bg-black/40 bg-black"'
    const achados = PADROES.flatMap((p) => [...amostra.matchAll(p)].map((m) => m[0]))
    expect(achados.sort()).toEqual(['bg-black', 'bg-white', 'text-gray-600'])
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- src/lib/ui/estilo.test.ts`
Expected: o segundo caso **passa** (a regex discrimina) e o primeiro **falha**, listando as violações arquivo por arquivo. Se o primeiro passar, a regex está quebrada — pare e conserte antes de converter nada, porque um portão que não vê nada não protege nada.

- [ ] **Step 3: Converter os 18 arquivos**

Mapa de conversão. Use-o como referência, mas leia o contexto de cada uso: `bg-black` num botão vira `bg-primary`, `bg-black/40` num véu de modal **fica como está**.

| Classe crua | Token | Observação |
|---|---|---|
| `bg-white` | `bg-card` | superfície de cartão/painel |
| `bg-neutral-50`, `bg-gray-50` | `bg-muted` | |
| `bg-neutral-100`, `bg-gray-100` | `bg-muted` | |
| `bg-neutral-200` | `bg-secondary` | |
| `text-neutral-400`, `text-neutral-500`, `text-neutral-600` | `text-muted-foreground` | |
| `text-gray-500`, `text-gray-600`, `text-gray-700` | `text-muted-foreground` | |
| `bg-black` + `text-white` (botão) | `bg-primary` + `text-primary-foreground` | |
| `bg-black/40`, `bg-black/50` (véu de modal) | **mantém** | é scrim, não cor |
| `bg-blue-600` | `bg-primary` | |
| `text-red-600`, `text-red-700` | `text-destructive` | |
| `bg-red-600` + `text-white` (botão de perigo) | `bg-destructive` + `text-primary-foreground` | |
| `bg-red-50`, `border-red-400` (caixa de erro) | `bg-destructive/10`, `border-destructive/40` | |
| `bg-amber-50` (caixa de aviso) | `bg-warning/10` | par com `border-warning/40` se houver borda |

Os arquivos, com o que cada um tem:

- `src/app/(app)/sino.tsx` — `bg-red-600`, `text-white`, `text-neutral-500`, `bg-neutral-50`, `text-neutral-600`, `bg-white`
- `src/app/(app)/funil/quadro.tsx` — `text-neutral-500`, `bg-neutral-200`, `bg-neutral-50`, `bg-red-50`, `text-red-700`
- `src/app/(app)/funil/cartao.tsx` — `bg-white`, `text-neutral-600`, `bg-neutral-100`, `text-neutral-500`, `text-red-600`
- `src/app/(app)/funil/novo-lead.tsx` — `bg-amber-50`, `text-neutral-600` (×2), `text-red-600`, `bg-black`/`text-white` (×2, botões), `bg-black/…` e `bg-white` (véu e painel do modal)
- `src/app/(app)/funil/modal-movimento.tsx` — `text-red-600`, `bg-neutral-100`, `bg-neutral-200`, `bg-black/…` e `bg-white` (véu e painel), `bg-black`/`text-white` (×2, botões)
- `src/app/(app)/leads/[id]/page.tsx` — `text-neutral-500` (×6)
- `src/app/(app)/leads/[id]/timeline.tsx` — `text-neutral-500` (×2)
- `src/app/(app)/leads/[id]/etiquetas.tsx` — `bg-neutral-100` (×2), `bg-neutral-200`, `text-red-600`
- `src/app/(app)/leads/[id]/acoes-lead.tsx` — `text-red-600`
- `src/app/(app)/leads/[id]/nota.tsx` — `text-red-600`, `bg-black`/`text-white`
- `src/app/(app)/config/integracoes.tsx` — `text-red-600`, `border-red-400`, `bg-red-50`, `text-gray-700` (×3), `bg-red-600`, `text-gray-600` (×2), `bg-gray-50`, `bg-gray-100`, `bg-blue-600`, `bg-amber-50`, `text-white` (×2)
- `src/app/(app)/config/entregas.tsx` — `text-gray-700`, `text-gray-600`, `bg-gray-100`, `text-gray-500`, `text-red-600`
- `src/app/(app)/config/usuarios.tsx` — `text-neutral-500` (×3), `bg-neutral-100`, `text-red-600`, `bg-black`/`text-white`
- `src/app/(app)/config/etapas.tsx` — `text-neutral-500`, `text-red-600`, `bg-black`/`text-white`
- `src/app/(app)/config/motivos.tsx` — `text-neutral-400`, `text-red-600`, `bg-black`/`text-white`
- `src/app/(auth)/login/formulario.tsx` — `text-neutral-600`, `text-red-600`, `bg-black`/`text-white`
- `src/app/(auth)/signup/formulario.tsx` — `text-neutral-600`, `text-red-600`, `bg-black`/`text-white`
- `src/app/(auth)/convite/[token]/page.tsx` — `text-red-600`

**Não** invente refatoração junto. Só a troca de classe. Qualquer mudança de estrutura aqui é ruído que o revisor não consegue separar da conversão.

- [ ] **Step 4: Rodar o portão e ver passar**

Run: `npm test -- src/lib/ui/estilo.test.ts`
Expected: ambos os casos passam.

Se sobrar violação em arquivo que você não converteu, ele não estava na lista acima — converta também. A lista é um atalho, o portão é a verdade.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: tudo verde.

Run: `npm run test:e2e` (com `npm run dev` derrubado, e `npx supabase start` de pé)
Expected: verde. É o que cobre os fluxos que a conversão poderia ter quebrado.

- [ ] **Step 6: Conferir com o olho**

Run: `npm run dev`, e passe por `/login`, `/funil` (arraste um card entre etapas), `/leads/<id>` e `/config`.
Expected: tudo legível sobre o fundo navy; nenhum texto escuro em fundo escuro; o feedback visual do arrastar continua existindo.

Este passo não é opcional e não é substituível pelo portão: no Plano 2 o feedback do drag-and-drop simplesmente não existia e nenhum teste automatizado percebeu.

Derrube o `npm run dev` antes de seguir.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ui/estilo.test.ts "src/app"
git commit -m "feat: converte as telas para tokens, com portao mecanico de completude"
```

---

### Task 3: `arvoreDoAnuncio` no port do Graph

**Files:**
- Modify: `src/lib/integracoes/meta.ts`
- Modify: `src/lib/integracoes/meta-real.ts:147-156`
- Modify: `src/lib/integracoes/meta-falso.ts:111-116`
- Test: `src/lib/integracoes/meta-real.test.ts`, `src/lib/integracoes/meta-falso.test.ts`

**Interfaces:**
- Consumes: `Resultado<T>` de `@/lib/domain/resultado`.
- Produces:
  ```ts
  export type ArvoreDeAnuncio = {
    anuncioId: string
    anuncioNome: string | null
    conjuntoId: string | null
    conjuntoNome: string | null
    campanhaId: string | null
    campanhaNome: string | null
  }
  // no interface MetaGraph:
  arvoreDoAnuncio(adId: string, tokenDaPagina: string): Promise<Resultado<ArvoreDeAnuncio>>
  ```
  A Task 5 consome exatamente isto.

`campanhaDoAnuncio` **continua existindo** ao fim desta task. Ele só sai na Task 6, depois que `processar.ts` parar de chamá-lo — assim nenhuma tarefa termina com o repo sem compilar.

- [ ] **Step 1: Escrever os testes que falham**

Em `src/lib/integracoes/meta-real.test.ts`, junto dos casos de `campanhaDoAnuncio` que já existem:

Vão dentro do `describe('MetaGraphReal — buscarLead, campanhaDoAnuncio e posseDaPagina')`, que já tem o `afterEach` restaurando `global.fetch`. O construtor é `new MetaGraphReal('app-id', 'app-secret')` — duas strings — e o duplo é `global.fetch`, não injeção. Renomeie o `describe` trocando `campanhaDoAnuncio` por `arvoreDoAnuncio`.

```ts
  it('arvoreDoAnuncio pede os tres niveis numa chamada so', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'ad-1',
        name: 'Anuncio Video 15s',
        adset: { id: 'adset-9', name: 'Conjunto Interesse' },
        campaign: { id: 'camp-7', name: 'Campanha de Verao' },
      }),
    })
    const g = new MetaGraphReal('app-id', 'app-secret')

    const r = await g.arvoreDoAnuncio('ad-1', 'token-da-pagina')

    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('deveria ter dado certo')
    expect(r.valor).toEqual({
      anuncioId: 'ad-1',
      anuncioNome: 'Anuncio Video 15s',
      conjuntoId: 'adset-9',
      conjuntoNome: 'Conjunto Interesse',
      campanhaId: 'camp-7',
      campanhaNome: 'Campanha de Verao',
    })
    // Uma ida ao Graph, nao tres: a arvore inteira cabe num `fields`. Tres
    // chamadas por lead multiplicariam a latencia do webhook por tres e
    // dariam tres chances de falha parcial.
    expect(global.fetch).toHaveBeenCalledTimes(1)
    const url = String((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])
    // Afirma sobre o valor decodificado, para o teste nao quebrar se a
    // codificacao de `{` e `,` mudar entre versoes de URL.
    expect(decodeURIComponent(url)).toContain('fields=name,adset{id,name},campaign{id,name}')
  })

  it('arvoreDoAnuncio devolve os niveis ausentes como nulo, sem inventar valor', async () => {
    // Anuncio orfao de campanha nao existe no Meta hoje, mas resposta 200 com
    // campo faltando existe (permissao parcial, objeto apagado). O contrato e
    // nulo — nunca string vazia, que na coluna viraria "campanha sem nome" e
    // agruparia leads de campanhas diferentes no mesmo balde.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'ad-2', name: 'So o anuncio' }),
    })
    const g = new MetaGraphReal('app-id', 'app-secret')

    const r = await g.arvoreDoAnuncio('ad-2', 'token-da-pagina')

    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('deveria ter dado certo')
    expect(r.valor).toEqual({
      anuncioId: 'ad-2',
      anuncioNome: 'So o anuncio',
      conjuntoId: null,
      conjuntoNome: null,
      campanhaId: null,
      campanhaNome: null,
    })
  })

  it('arvoreDoAnuncio devolve meta_indisponivel quando o fetch rejeita', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('rede caiu'))
    const g = new MetaGraphReal('app-id', 'app-secret')

    const r = await g.arvoreDoAnuncio('ad-1', 'token-da-pagina')

    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('deveria ter falhado')
    expect(r.erro).toBe('meta_indisponivel')
  })
```

Em `src/lib/integracoes/meta-falso.test.ts`:

```ts
  it('arvoreDoAnuncio e deterministica no proprio adId', async () => {
    const g = new MetaGraphFalso()

    const r1 = await g.arvoreDoAnuncio('ad-1', 't')
    const r2 = await g.arvoreDoAnuncio('ad-1', 't')

    expect(r1).toEqual(r2)
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    expect(r1.valor.anuncioId).toBe('ad-1')
    expect(r1.valor.campanhaNome).toBe('Campanha ad-1')
  })

  it('arvoreDoAnuncio respeita o barrado', async () => {
    const g = new MetaGraphFalso()
    g.falharEm = 'arvoreDoAnuncio'

    const r = await g.arvoreDoAnuncio('ad-1', 't')

    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.erro).toBe('meta_indisponivel')
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- src/lib/integracoes`
Expected: FAIL com `arvoreDoAnuncio is not a function` (ou erro de tipo no typecheck). Os casos existentes de `campanhaDoAnuncio` continuam verdes.

- [ ] **Step 3: Declarar o tipo e o método no port**

Em `src/lib/integracoes/meta.ts`, adicione o tipo antes da interface e o método dentro dela, mantendo `campanhaDoAnuncio` por enquanto:

```ts
/**
 * Os tres niveis da arvore de um anuncio do Meta. Id e nome andam em par
 * porque a metrica agrupa pelo ID (renomear campanha no gerenciador e rotina
 * e nao pode partir o historico em duas linhas) e exibe o NOME. Nome nulo e
 * estado legitimo: o Google nunca manda nome nenhum, e o Meta pode omitir um
 * nivel numa resposta parcial.
 */
export type ArvoreDeAnuncio = {
  anuncioId: string
  anuncioNome: string | null
  conjuntoId: string | null
  conjuntoNome: string | null
  campanhaId: string | null
  campanhaNome: string | null
}
```

```ts
  /** Nome da campanha dona do anuncio. Substituido por arvoreDoAnuncio; sai no fim deste plano. */
  campanhaDoAnuncio(adId: string, tokenDaPagina: string): Promise<Resultado<string>>
  /**
   * Anuncio, conjunto e campanha numa ida so ao Graph. Substitui
   * campanhaDoAnuncio: mesma chamada, mesmo custo, tres niveis em vez de um
   * nome — e com os ids, que sao o que a metrica agrupa.
   */
  arvoreDoAnuncio(adId: string, tokenDaPagina: string): Promise<Resultado<ArvoreDeAnuncio>>
```

- [ ] **Step 4: Implementar em `meta-real.ts`**

Logo abaixo de `campanhaDoAnuncio`:

```ts
  async arvoreDoAnuncio(adId: string, tokenDaPagina: string): Promise<Resultado<ArvoreDeAnuncio>> {
    const url = new URL(`${BASE}/${adId}`)
    url.searchParams.set('fields', 'name,adset{id,name},campaign{id,name}')
    url.searchParams.set('access_token', tokenDaPagina)

    const r = await chamar<{
      name?: string
      adset?: { id?: string; name?: string }
      campaign?: { id?: string; name?: string }
    }>(url)
    if (!r.ok) return falha(r.erro)
    // Diferente de buscarLead, aqui nao ha guarda de forma que rejeite a
    // resposta: nivel ausente e resultado valido (ver o tipo). O adId vem do
    // argumento, e nao do corpo, porque e o unico dado que ja sabemos ser
    // verdadeiro mesmo numa resposta parcial.
    return ok({
      anuncioId: adId,
      anuncioNome: r.valor.name ?? null,
      conjuntoId: r.valor.adset?.id ?? null,
      conjuntoNome: r.valor.adset?.name ?? null,
      campanhaId: r.valor.campaign?.id ?? null,
      campanhaNome: r.valor.campaign?.name ?? null,
    })
  }
```

Adicione `ArvoreDeAnuncio` ao import de tipos vindo de `@/lib/integracoes/meta`.

- [ ] **Step 5: Implementar em `meta-falso.ts`**

```ts
  async arvoreDoAnuncio(adId: string, _tokenDaPagina: string): Promise<Resultado<ArvoreDeAnuncio>> {
    if (this.barrado('arvoreDoAnuncio')) return falha('meta_indisponivel')
    // Deterministico no proprio adId, sem estado nem Math.random: o mesmo
    // adId devolve a mesma arvore em chamadas repetidas do mesmo teste.
    return ok({
      anuncioId: adId,
      anuncioNome: `Anuncio ${adId}`,
      conjuntoId: `adset-${adId}`,
      conjuntoNome: `Conjunto ${adId}`,
      campanhaId: `camp-${adId}`,
      campanhaNome: `Campanha ${adId}`,
    })
  }
```

Adicione `ArvoreDeAnuncio` ao import de tipos e `'arvoreDoAnuncio'` à união de nomes que `falharEm`/`barrado` aceitam, se ela for tipada.

- [ ] **Step 6: Rodar e ver passar**

Run: `npm test -- src/lib/integracoes && npm run typecheck`
Expected: PASS nos dois.

- [ ] **Step 7: Commit**

```bash
git add src/lib/integracoes
git commit -m "feat: arvoreDoAnuncio traz anuncio, conjunto e campanha numa chamada"
```

---

### Task 4: `DadosDoLead` e os mapeadores emitem os campos de rastreamento

**Files:**
- Modify: `src/lib/ingestao/dados.ts`
- Modify: `src/lib/ingestao/mapear-meta.ts:43-83`
- Modify: `src/lib/ingestao/mapear-google.ts:78-95`
- Modify: `src/lib/ingestao/processar.ts:88-101`
- Test: `src/lib/ingestao/dados.test.ts`, `mapear-meta.test.ts`, `mapear-google.test.ts`, `processar.test.ts`

**Interfaces:**
- Consumes: `ArvoreDeAnuncio` e `arvoreDoAnuncio` da Task 3.
- Produces: `DadosDoLead` com os campos abaixo, e `paraPayload` emitindo as chaves snake_case correspondentes. A Task 5 (migration) lê exatamente essas chaves.
  ```ts
  campanhaId: string | null
  campanhaNome: string | null
  conjuntoId: string | null
  conjuntoNome: string | null
  anuncioId: string | null
  anuncioNome: string | null
  formularioId: string | null
  clickId: string | null
  ```

**Esta é a metade "expand" do expand/contract.** `paraPayload` passa a emitir as chaves novas **e mantém** `campanha_origem`/`formulario_origem`. A migration da Task 5 ainda não existe, então o banco continua lendo as chaves antigas e ignorando as novas — `p_dados` é `jsonb` e chave a mais não incomoda. Resultado: a suíte fica verde nesta task, E2E incluído.

- [ ] **Step 1: Escrever os testes que falham**

Em `src/lib/ingestao/dados.test.ts`:

**`dados.test.ts` afirma de forma exaustiva**, e é por isso que ele é o teste certo para guiar esta task: `Object.keys(payload).sort()` compara o conjunto **inteiro** de chaves, e os outros dois casos usam `toEqual`, não `toMatchObject`. Acrescentar campo ao payload sem tocar neles os deixa vermelhos — o que é o comportamento desejado, não um estorvo. Atualize os três.

Na constante `DADOS` (linha 4), acrescente os oito campos novos; e no caso `'repassa nulos como nulos'`, acrescente os oito como `null`.

No caso `'emite exatamente o conjunto de chaves snake_case que a RPC ingerir_lead espera'`, a lista passa a ser:

```ts
      [
        'nome',
        'telefone',
        'telefone_e164',
        'email',
        'email_norm',
        'empresa',
        'campanha_origem',
        'formulario_origem',
        'campanha_id',
        'campanha_nome',
        'conjunto_id',
        'conjunto_nome',
        'anuncio_id',
        'anuncio_nome',
        'formulario_id',
        'click_id',
        'extras',
      ].sort()
```

`campanha_origem` e `formulario_origem` **continuam na lista nesta task** — é a metade "expand", e é o que mantém a migration atual (que ainda lê essas chaves) funcionando. A Task 6 as remove.

E um caso novo, provando que os valores atravessam sem transformação:

```ts
  it('paraPayload emite as chaves de rastreamento em snake_case', () => {
    const payload = paraPayload({
      ...DADOS,
      campanhaId: 'camp-7',
      campanhaNome: 'Campanha de Verao',
      conjuntoId: 'adset-9',
      conjuntoNome: 'Conjunto Interesse',
      anuncioId: 'ad-1',
      anuncioNome: 'Video 15s',
      formularioId: 'form-3',
      clickId: 'gcl-abc',
    })

    expect(payload).toMatchObject({
      campanha_id: 'camp-7',
      campanha_nome: 'Campanha de Verao',
      conjunto_id: 'adset-9',
      conjunto_nome: 'Conjunto Interesse',
      anuncio_id: 'ad-1',
      anuncio_nome: 'Video 15s',
      formulario_id: 'form-3',
      click_id: 'gcl-abc',
    })
  })
```

Em `src/lib/ingestao/mapear-meta.test.ts`:

```ts
  it('a arvore do anuncio vira os seis campos de rastreamento', () => {
    const dados = mapearLeadDoMeta(LEAD_BASE, {
      arvore: {
        anuncioId: 'ad-1',
        anuncioNome: 'Video 15s',
        conjuntoId: 'adset-9',
        conjuntoNome: 'Conjunto Interesse',
        campanhaId: 'camp-7',
        campanhaNome: 'Campanha de Verao',
      },
      formularioId: 'form-3',
    })

    expect(dados.campanhaId).toBe('camp-7')
    expect(dados.campanhaNome).toBe('Campanha de Verao')
    expect(dados.conjuntoId).toBe('adset-9')
    expect(dados.conjuntoNome).toBe('Conjunto Interesse')
    expect(dados.anuncioId).toBe('ad-1')
    expect(dados.anuncioNome).toBe('Video 15s')
    expect(dados.formularioId).toBe('form-3')
    // Lead do Meta nunca tem click id: o gcl_id e conceito do Google Ads.
    expect(dados.clickId).toBeNull()
  })

  it('sem arvore, so o anuncio sobrevive e nada e inventado', () => {
    // E o estado depois de arvoreDoAnuncio falhar: o anuncioId veio de
    // buscarLead, que deu certo. Os outros cinco tem que ficar nulos, e nao
    // receber o adId cru — foi exatamente essa confusao (ad_id ocupando a
    // coluna de nome de campanha) que este plano existe para desfazer.
    const dados = mapearLeadDoMeta(LEAD_BASE, {
      arvore: null,
      anuncioId: 'ad-1',
      formularioId: 'form-3',
    })

    expect(dados.anuncioId).toBe('ad-1')
    expect(dados.anuncioNome).toBeNull()
    expect(dados.conjuntoId).toBeNull()
    expect(dados.conjuntoNome).toBeNull()
    expect(dados.campanhaId).toBeNull()
    expect(dados.campanhaNome).toBeNull()
  })
```

Em `src/lib/ingestao/mapear-google.test.ts`:

```ts
  it('os ids do Google viram rastreamento, e todo nome fica nulo', () => {
    const payload = {
      campaign_id: 123456789,
      adgroup_id: 222,
      creative_id: 333,
      form_id: 987654321,
      gcl_id: 'gcl-abc',
      user_column_data: [],
    }

    const dados = mapearLeadDoGoogle(payload)

    // Numero vira texto: as colunas sao text, e o mesmo id chegando ora como
    // numero ora como string criaria dois grupos na metrica.
    expect(dados.campanhaId).toBe('123456789')
    expect(dados.conjuntoId).toBe('222')
    expect(dados.anuncioId).toBe('333')
    expect(dados.formularioId).toBe('987654321')
    expect(dados.clickId).toBe('gcl-abc')
    // O Google nao manda nome nenhum, e resolver exigiria a Google Ads API
    // com developer token. Nulo e o contrato — a tela exibe o id rotulado
    // como id em vez de fingir que e nome.
    expect(dados.campanhaNome).toBeNull()
    expect(dados.conjuntoNome).toBeNull()
    expect(dados.anuncioNome).toBeNull()
  })

  it('payload sem nenhum id de rastreamento cai tudo em nulo', () => {
    const dados = mapearLeadDoGoogle({ user_column_data: [] })

    expect(dados.campanhaId).toBeNull()
    expect(dados.conjuntoId).toBeNull()
    expect(dados.anuncioId).toBeNull()
    expect(dados.formularioId).toBeNull()
    expect(dados.clickId).toBeNull()
  })
```

Em `src/lib/ingestao/processar.test.ts` há três casos que hoje afirmam sobre `campanhaOrigem`. **Reaproveite o setup de cada um integralmente — só as asserções mudam.** Não monte entrega nova nem invente helper: o arquivo já tem o padrão de `semearLog` e `MetaGraphFalso`, e um segundo estilo de setup no mesmo arquivo é ruído para o revisor.

1. O caso que hoje afirma `campanhaOrigem === 'Campanha ad-padrao'` (por volta da linha 33) — renomeie para `'chama arvoreDoAnuncio e grava os tres niveis'` e troque a asserção por:

```ts
    expect(ingestao.ingeridos[0]?.dados.campanhaNome).toBe('Campanha ad-padrao')
    expect(ingestao.ingeridos[0]?.dados.conjuntoId).toBe('adset-ad-padrao')
    expect(ingestao.ingeridos[0]?.dados.anuncioId).toBe('ad-padrao')
```

2. `'campanha e best-effort: falha em campanhaDoAnuncio ingere do mesmo jeito, com campanhaOrigem no ad_id cru'` (linha 120) — renomeie para `'arvore e best-effort: falha nela ingere com so o anuncioId'`, troque `graph.falharEm = 'campanhaDoAnuncio'` por `'arvoreDoAnuncio'`, e as asserções por:

```ts
    expect(ingestao.ingeridos[0]?.dados.anuncioId).toBe('ad-padrao')
    expect(ingestao.ingeridos[0]?.dados.campanhaId).toBeNull()
    expect(ingestao.ingeridos[0]?.dados.campanhaNome).toBeNull()
```

Este é o caso que prova a correção central do plano: na versão antiga, falhar aqui gravava o `ad_id` cru na coluna de nome de campanha. Agora o anúncio fica identificado e o resto, honestamente nulo.

3. `'sem ad_id no lead do Graph, nem tenta buscar campanha e ingere normalmente'` (linha 147) — mantenha o nome trocando "campanha" por "a arvore", e as asserções por:

```ts
    // Nulo, e nao 'Campanha null' nem o adId: prova de que a chamada nem
    // rodou, por nao haver ad_id para pedir.
    expect(ingestao.ingeridos[0]?.dados.anuncioId).toBeNull()
    expect(ingestao.ingeridos[0]?.dados.campanhaNome).toBeNull()
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- src/lib/ingestao`
Expected: FAIL — propriedades inexistentes em `DadosDoLead`, e `mapearLeadDoMeta` recusando a nova forma do segundo argumento.

- [ ] **Step 3: Estender `DadosDoLead` e `paraPayload`**

Em `src/lib/ingestao/dados.ts`, dentro do tipo, depois de `empresa`:

```ts
  /** Rastreamento de origem, em pares id/nome. A metrica agrupa pelo ID
   * (renomear campanha no gerenciador nao pode partir o historico) e exibe o
   * NOME. Nome nulo e legitimo: o Google nunca manda nome. */
  campanhaId: string | null
  campanhaNome: string | null
  conjuntoId: string | null
  conjuntoNome: string | null
  anuncioId: string | null
  anuncioNome: string | null
  formularioId: string | null
  /** gcl_id do Google. Nao e lido por nada hoje: entra porque chega de graca
   * no payload e e a unica chave que um dia fecha o laco de conversao
   * offline de volta no Google Ads — capturar depois e impossivel. */
  clickId: string | null
```

Mantenha `campanhaOrigem` e `formularioOrigem` no tipo por enquanto: eles saem na Task 6.

Em `paraPayload`, acrescente as chaves novas **sem remover** as antigas:

```ts
    campanha_origem: d.campanhaOrigem,
    formulario_origem: d.formularioOrigem,
    campanha_id: d.campanhaId,
    campanha_nome: d.campanhaNome,
    conjunto_id: d.conjuntoId,
    conjunto_nome: d.conjuntoNome,
    anuncio_id: d.anuncioId,
    anuncio_nome: d.anuncioNome,
    formulario_id: d.formularioId,
    click_id: d.clickId,
```

- [ ] **Step 4: Reescrever o segundo argumento de `mapearLeadDoMeta`**

A assinatura passa de `{ campanha, formulario }` para:

```ts
export function mapearLeadDoMeta(
  lead: LeadDoMeta,
  extra: {
    /** Nula quando arvoreDoAnuncio falhou ou nem rodou. */
    arvore: ArvoreDeAnuncio | null
    /** Usado so quando `arvore` e nula: vem de buscarLead, que deu certo. */
    anuncioId?: string | null
    formularioId: string | null
  }
): DadosDoLead {
```

E o retorno, no lugar de `campanhaOrigem`/`formularioOrigem`:

```ts
    campanhaOrigem: null,
    formularioOrigem: extra.formularioId,
    campanhaId: extra.arvore?.campanhaId ?? null,
    campanhaNome: extra.arvore?.campanhaNome ?? null,
    conjuntoId: extra.arvore?.conjuntoId ?? null,
    conjuntoNome: extra.arvore?.conjuntoNome ?? null,
    anuncioId: extra.arvore?.anuncioId ?? extra.anuncioId ?? null,
    anuncioNome: extra.arvore?.anuncioNome ?? null,
    formularioId: extra.formularioId,
    // Conceito do Google Ads; o Meta nao tem equivalente no payload de leadgen.
    clickId: null,
```

- [ ] **Step 5: Estender `mapearLeadDoGoogle`**

Uma função local, porque o padrão "número ou string vira texto, resto vira nulo" aparece cinco vezes:

```ts
/** O Google manda id como numero. Vira texto porque as colunas sao text — e
 * porque o mesmo id chegando ora numero ora string criaria dois grupos
 * distintos na metrica. */
function idOuNulo(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v === 'string' && v.length > 0) return v
  return null
}
```

No retorno, substituindo as duas linhas de `campanhaOrigem`/`formularioOrigem`:

```ts
    campanhaOrigem: null,
    formularioOrigem: idOuNulo(payload.form_id),
    campanhaId: idOuNulo(payload.campaign_id),
    campanhaNome: null,
    conjuntoId: idOuNulo(payload.adgroup_id),
    conjuntoNome: null,
    anuncioId: idOuNulo(payload.creative_id),
    anuncioNome: null,
    formularioId: idOuNulo(payload.form_id),
    clickId: idOuNulo(payload.gcl_id),
```

- [ ] **Step 6: Trocar a ordem best-effort em `processar.ts`**

Substitua o bloco das linhas 88–99 por:

```ts
  // Sem arvore ainda: o anuncioId vem de buscarLead, que ja deu certo. Se a
  // chamada abaixo falhar, e este o estado final — anuncio identificado e o
  // resto nulo. A versao anterior gravava o ad_id cru na coluna de nome de
  // campanha, e o dado resultante era indistinguivel de um nome real.
  const dados = mapearLeadDoMeta(lead, {
    arvore: null,
    anuncioId: lead.adId,
    formularioId: lead.formId,
  })

  if (lead.adId) {
    const resultadoArvore = await deps.graph.arvoreDoAnuncio(lead.adId, e.token)
    // Falha aqui nunca vira registrarFalha: nenhum lead se perde por causa do
    // nome da campanha.
    if (resultadoArvore.ok) {
      const a = resultadoArvore.valor
      dados.campanhaId = a.campanhaId
      dados.campanhaNome = a.campanhaNome
      dados.conjuntoId = a.conjuntoId
      dados.conjuntoNome = a.conjuntoNome
      dados.anuncioId = a.anuncioId
      dados.anuncioNome = a.anuncioNome
    }
  }
```

Atualize também o comentário de bloco da função (linha 49): "Graph → mapeia → campanha best-effort → ingerirLead" vira "→ árvore do anúncio best-effort →".

- [ ] **Step 7: Rodar e ver passar**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS, com `campanha_origem` e `formulario_origem` ainda presentes na lista de chaves de `dados.test.ts`.

Run: `npm run test:integration`
Expected: PASS **sem nenhuma alteração em migration ou em teste de integração**. É isso que prova que o expand foi mesmo compatível: o `p_dados` só ganhou chaves que o banco ainda ignora. Se algum teste de integração ficar vermelho aqui, algo saiu do payload que não devia — investigue em vez de ajustar o teste.

- [ ] **Step 8: Commit**

```bash
git add src/lib/ingestao
git commit -m "feat: mapeadores emitem campanha, conjunto e anuncio em pares id/nome"
```

---

### Task 5: Migration `0013` — colunas de rastreamento

**Files:**
- Create: `supabase/migrations/0013_rastreamento.sql`
- Test: `tests/integration/0013_rastreamento.test.ts`
- Modify: `tests/integration/0011_ingerir_lead.test.ts`

**Interfaces:**
- Consumes: as chaves snake_case que `paraPayload` já emite (Task 4).
- Produces: as oito colunas em `public.leads`, e `ingerir_lead` gravando-as. A tabela de canais do plano de Métricas lê exatamente estas colunas.

**Esta é a metade "contract" do lado do banco.** Como a Task 4 já subiu, o TypeScript já manda as chaves novas: no instante em que esta migration entra, os leads passam a chegar com rastreamento e nada fica no meio do caminho.

- [ ] **Step 1: Escrever os testes que falham**

Crie `tests/integration/0013_rastreamento.test.ts`.

**Sobre os identificadores no código abaixo:** `cli`, `SEGREDO`, `accountId` e `logId` aparecem como marcadores de posição para o que `tests/integration/0011_ingerir_lead.test.ts` já constrói — abra aquele arquivo e reuse os nomes e o `beforeEach` dele. Não crie helper de semeadura novo: o `helpers/db.ts` já existe e um segundo caminho de setup divergiria dele em silêncio. Os trechos marcados com `// ...` são exatamente essa semeadura, e o único jeito certo de preenchê-los é copiando do arquivo vizinho.

```ts
  it('as colunas ambiguas sairam e as de rastreamento entraram', async () => {
    const colunas = await cli.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'leads'`,
    )
    const nomes = colunas.rows.map((r) => r.column_name)

    // campanha_origem guardava NOME no Meta e ID no Google. Enquanto a coluna
    // existir, alguem volta a escrever nela e a ambiguidade retorna.
    expect(nomes).not.toContain('campanha_origem')
    expect(nomes).not.toContain('formulario_origem')

    for (const c of [
      'campanha_id', 'campanha_nome', 'conjunto_id', 'conjunto_nome',
      'anuncio_id', 'anuncio_nome', 'formulario_id', 'click_id',
    ]) {
      expect(nomes).toContain(c)
    }
  })

  it('ingerir_lead grava os seis campos de rastreamento do Meta', async () => {
    // ... semeie conta, fonte 'meta' e uma linha pendente de integration_log,
    // como tests/integration/0011_ingerir_lead.test.ts ja faz ...
    await cli.query(`select public.ingerir_lead($1, $2, $3)`, [
      SEGREDO,
      logId,
      JSON.stringify({
        nome: 'Fulano',
        email: 'fulano@example.com',
        campanha_id: 'camp-7',
        campanha_nome: 'Campanha de Verao',
        conjunto_id: 'adset-9',
        conjunto_nome: 'Conjunto Interesse',
        anuncio_id: 'ad-1',
        anuncio_nome: 'Video 15s',
        formulario_id: 'form-3',
        click_id: null,
        extras: {},
      }),
    ])

    const r = await cli.query(
      `select campanha_id, campanha_nome, conjunto_id, conjunto_nome,
              anuncio_id, anuncio_nome, formulario_id, click_id
         from public.leads where account_id = $1`,
      [accountId],
    )
    expect(r.rows[0]).toEqual({
      campanha_id: 'camp-7',
      campanha_nome: 'Campanha de Verao',
      conjunto_id: 'adset-9',
      conjunto_nome: 'Conjunto Interesse',
      anuncio_id: 'ad-1',
      anuncio_nome: 'Video 15s',
      formulario_id: 'form-3',
      click_id: null,
    })
  })

  it('ingerir_lead aceita payload sem nenhum campo de rastreamento', async () => {
    // Lead do Google sem os ids opcionais, ou Meta com arvore falhada. Nao
    // pode estourar: nada aqui e obrigatorio.
    // ... semeie e chame com { nome, email, extras: {} } apenas ...
    const r = await cli.query(
      `select campanha_id, anuncio_id from public.leads where account_id = $1`,
      [accountId],
    )
    expect(r.rows[0]).toEqual({ campanha_id: null, anuncio_id: null })
  })

  it('ingerir_lead continua com uma assinatura so, sem sobrecarga', async () => {
    // create or replace com lista de argumentos diferente cria SOBRECARGA em
    // vez de substituir, e as duas versoes conviveriam. Aconteceu na 0012 e
    // custou um drop function explicito. Aqui a assinatura nao muda — este
    // teste e o que garante que ela nao mudou por acidente.
    const r = await cli.query<{ n: string }>(
      `select count(*)::text as n from pg_proc
        where pronamespace = 'public'::regnamespace and proname = 'ingerir_lead'`,
    )
    expect(r.rows[0]?.n).toBe('1')
  })
```

Em `tests/integration/0011_ingerir_lead.test.ts`, troque as chaves `campanha_origem`/`formulario_origem` dos payloads por `campanha_id`/`formulario_id`, e as asserções correspondentes pelas colunas novas.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:integration -- tests/integration/0013_rastreamento.test.ts`
Expected: FAIL — colunas inexistentes.

- [ ] **Step 3: Escrever a migration**

```sql
-- supabase/migrations/0013_rastreamento.sql
--
-- Sub-projeto 3: rastreamento de origem ate o nivel do anuncio.
--
-- Por que as duas colunas antigas saem em vez de ficarem: campanha_origem
-- guardava coisas DIFERENTES por provedor — o nome da campanha no Meta
-- (campaign{name}) e o id numerico no Google (String(payload.campaign_id)).
-- Agrupar por ela na metrica mostraria "Black November" numa linha e
-- "123456789" na outra. Enquanto a coluna existir, alguem volta a escrever
-- nela.
--
-- Por que id E nome: a metrica agrupa pelo ID, porque renomear campanha no
-- gerenciador do Meta e rotina e partiria o historico em duas linhas; e exibe
-- o NOME, escolhendo o do lead mais recente daquele id. Nome nulo e estado
-- legitimo e permanente para o Google, que nunca manda nome — resolver
-- exigiria a Google Ads API com developer token.
--
-- Nao ha backfill porque nao ha dado: nada deste projeto foi para producao
-- ainda (webhook nunca verificado no painel do Meta, sem URL publica,
-- META_APP_ID vazio).

alter table public.leads
  drop column campanha_origem,
  drop column formulario_origem,
  add column campanha_id    text,
  add column campanha_nome  text,
  add column conjunto_id    text,
  add column conjunto_nome  text,
  add column anuncio_id     text,
  add column anuncio_nome   text,
  add column formulario_id  text,
  -- gcl_id do Google. Nao e lido por nada hoje: entra porque chega de graca
  -- no payload e e a unica chave que um dia fecha o laco de conversao offline
  -- de volta no Google Ads. Capturar depois e impossivel para o lead que ja
  -- passou.
  add column click_id       text;

-- Sem grant novo: as colunas herdam o privilegio e a RLS de public.leads, que
-- ja e pode_ver_lead. Sem tabela nova, nao ha armadilha de default ACL aqui.

-- A metrica agrupa por campanha_id dentro de origem. Sem indice, cada carga
-- da aba varre a conta inteira.
create index leads_account_campanha_idx on public.leads (account_id, campanha_id);

-- ingerir_lead precisa ser recriada porque o insert dela nomeia as colunas
-- que acabaram de sair. A assinatura NAO muda (p_segredo text, p_log_id uuid,
-- p_dados jsonb), entao `create or replace` de fato substitui. Se algum dia a
-- lista de argumentos mudar, sera preciso `drop function` com a assinatura
-- antiga antes: `create or replace` com argumentos diferentes cria uma
-- SOBRECARGA e as duas versoes convivem — foi o que a 0012 teve que tratar.
create or replace function public.ingerir_lead(
  p_segredo text,
  p_log_id uuid,
  p_dados jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
-- COPIE o corpo inteiro de supabase/migrations/0011_ingerir_lead.sql,
-- alterando APENAS o insert em public.leads (linhas 168-188 daquele arquivo)
-- para a forma abaixo. Nao reescreva o resto de memoria: o corpo carrega
-- garantias que foram achadas em review (e_membro_da_conta reafirmado nos
-- DOIS ramos, o `for update` que serializa a entrega, o coalesce do nome).
$$;
```

**Atenção do implementador:** o passo acima manda copiar o corpo de `0011_ingerir_lead.sql` e trocar só o `insert`. Faça exatamente isso — abra o arquivo e copie. O `insert` novo:

```sql
  insert into public.leads (
    account_id, nome, telefone, telefone_e164, email, email_norm, empresa,
    origem, campanha_id, campanha_nome, conjunto_id, conjunto_nome,
    anuncio_id, anuncio_nome, formulario_id, click_id,
    pipeline_id, stage_id, responsavel_id
  ) values (
    v_account,
    coalesce(nullif(btrim(coalesce(p_dados ->> 'nome', '')), ''), 'Lead sem nome'),
    p_dados ->> 'telefone',
    v_tel,
    p_dados ->> 'email',
    v_email,
    p_dados ->> 'empresa',
    v_log.provedor::text::public.lead_origem,
    p_dados ->> 'campanha_id',
    p_dados ->> 'campanha_nome',
    p_dados ->> 'conjunto_id',
    p_dados ->> 'conjunto_nome',
    p_dados ->> 'anuncio_id',
    p_dados ->> 'anuncio_nome',
    p_dados ->> 'formulario_id',
    p_dados ->> 'click_id',
    v_pipeline, v_stage, v_resp_padrao
  ) returning id into v_lead;
```

- [ ] **Step 4: Aplicar e rodar**

Run: `npx supabase db reset`
Expected: as 13 migrations aplicam sem erro.

Run: `npm run test:integration`
Expected: PASS, incluindo `0011_ingerir_lead.test.ts` já ajustado.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: verde.

Run: `npm run test:e2e` (com `npm run dev` derrubado)
Expected: verde. É o que prova que o caminho webhook → card continua inteiro depois da troca de colunas.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0013_rastreamento.sql tests/integration
git commit -m "feat: migration 0013 troca campanha_origem por rastreamento ate o anuncio"
```

---

### Task 6: Contract — remover o caminho antigo

**Files:**
- Modify: `src/lib/ingestao/dados.ts`
- Modify: `src/lib/ingestao/mapear-meta.ts`, `mapear-google.ts`
- Modify: `src/lib/integracoes/meta.ts`, `meta-real.ts`, `meta-falso.ts`
- Test: `src/lib/ingestao/dados.test.ts`, `src/lib/integracoes/meta-real.test.ts`, `meta-falso.test.ts`

**Interfaces:**
- Consumes: tudo das Tasks 3–5.
- Produces: `DadosDoLead` sem `campanhaOrigem`/`formularioOrigem`; `MetaGraph` sem `campanhaDoAnuncio`.

Agora que o banco não lê mais as chaves antigas e ninguém chama `campanhaDoAnuncio`, os dois saem. Deixá-los seria código morto com aparência de contrato vivo — o próximo a ler `MetaGraph` não teria como saber qual dos dois métodos usar.

- [ ] **Step 1: Apagar os testes do caminho antigo**

Remova de `src/lib/ingestao/dados.test.ts` os casos que afirmam sobre `campanha_origem`/`formulario_origem`, e de `meta-real.test.ts`/`meta-falso.test.ts` os casos de `campanhaDoAnuncio`.

- [ ] **Step 2: Remover o código morto**

- `dados.ts`: apague `campanhaOrigem` e `formularioOrigem` do tipo e as duas linhas correspondentes em `paraPayload`.
- `mapear-meta.ts` e `mapear-google.ts`: apague as duas linhas `campanhaOrigem: null` / `formularioOrigem: ...` do retorno.
- `meta.ts`: apague a declaração de `campanhaDoAnuncio`.
- `meta-real.ts` e `meta-falso.ts`: apague as duas implementações.

- [ ] **Step 3: Rodar tudo**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: verde. O typecheck é o que prova que ninguém mais referenciava os símbolos removidos — se ele reclamar, há um chamador que este plano não mapeou; **não** reintroduza o método, siga o erro até o chamador.

Run: `npm run test:integration && npm run test:e2e`
Expected: verde.

- [ ] **Step 4: Commit**

```bash
git add src/lib
git commit -m "refactor: remove campanhaDoAnuncio e as chaves de origem ambiguas"
```

---

## Verificação final da branch

- [ ] `npx supabase db reset` e depois `npm test && npm run test:integration && npm run test:e2e && npm run typecheck && npm run lint && npm run build` — **a suíte tem que ser rodada no resultado do merge, não só antes dele.** É a disciplina que os Planos 3 e 4 seguiram.
- [ ] Abrir o app e passar pelas telas convertidas com o olho, uma última vez.
- [ ] `grep -rn "campanha_origem\|formulario_origem\|campanhaDoAnuncio" src/ supabase/migrations/0013_rastreamento.sql tests/` — só pode haver ocorrência em `0003_leads.sql` e `0011_ingerir_lead.sql`, que são migrations históricas e não se editam.

## O que este plano deliberadamente não faz

- **Não exibe o rastreamento na ficha do lead.** Nenhuma tela lê as colunas novas ainda; quem as consome é o plano de Métricas. Adicionar a exibição aqui seria escopo que ninguém pediu.
- **Não paga a dívida de teste de componente.** O portão de estilo prova completude, não correção visual. A dívida continua no backlog.
- **Não resolve nome de campanha do Google.** Exigiria a Google Ads API com developer token — semanas de aprovação e um OAuth que o projeto evitou de propósito.
