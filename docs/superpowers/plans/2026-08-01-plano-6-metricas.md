# Plano 6 — Aba de Métricas

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma aba `/metricas` que responde três perguntas sobre a coorte de leads de um período: onde o funil vaza, quais etiquetas os leads carregavam em cada etapa, e qual canal — até o anúncio — traz o lead que fecha.

**Architecture:** Híbrido deliberado. Duas RPCs `security invoker` fazem só o que o SQL faz melhor: uma devolve **uma linha por lead** com a profundidade máxima alcançada (`max(ordem)` sobre a união das etapas que o lead já ocupou), a outra devolve uma linha por aplicação de etiqueta. Toda regra de negócio — degraus, denominadores, agrupamento por id com nome mais recente — vive em funções puras em `src/lib/domain/metricas.ts`, que rodam sob teste unitário sem Docker. Nenhum código de autorização novo: a RLS que já protege o funil recorta as duas RPCs.

**Tech Stack:** Next.js 15 (App Router) + React 19 + TypeScript + Tailwind v4 + Supabase (Postgres/RLS) + vitest + Playwright.

## Global Constraints

- **Nenhuma dependência nova.** Em particular **nenhuma biblioteca de gráfico** — as barras são `div` com largura percentual. `package.json` não muda.
- **`npx supabase`, nunca `supabase`** — o binário não está no PATH desta máquina.
- **Toda função Postgres nova precisa de `grant execute` explícito para `authenticated`**: o default ACL do schema `public` nesta imagem (Postgres 17.6) concede a `anon`/`authenticated` apenas `Dxtm`.
- **Migrations são registro histórico: nenhuma existente pode ser editada.** Tudo novo vai em `0014_metricas.sql`.
- **Domínio é puro, sem IO.** Todo acesso a dados passa pelo port e devolve `Resultado<T>` (`src/lib/domain/resultado.ts`).
- **Nenhuma classe de paleta crua do Tailwind.** `src/lib/ui/estilo.test.ts` varre `src/` e falha se alguma aparecer. Use tokens: `bg-card`, `bg-muted`, `bg-secondary`, `bg-primary`, `text-foreground`, `text-muted-foreground`, `text-primary-foreground`, `text-destructive`, `border-border`, `bg-warning`, e `--chart-1..5` para as barras. Utilitárias disponíveis: `.tabular`, `.eyebrow`, `.surface`, `.accent-top`, `.fade-in`.
- **Toda ordenação nova precisa de desempate determinístico.** Este projeto já foi mordido por empate de ordenação (backlog #10).
- Nomes e comentários em português. Comentário explica *por quê*, não *o quê*.
- **Nenhuma contagem de teste aparece neste plano.** O portão é "suíte verde e todo teste novo com RED demonstrado".
- **Antes de rodar E2E:** derrube qualquer `npm run dev` — o `reuseExistingServer` do Playwright se conecta a um servidor que subiu sem `META_FAKE`. A suíte roda `workers: 1` de propósito.
- **Se um teste que deveria falhar passar, pare e investigue.** Não afrouxe a asserção.
- Comandos: `npm test` · `npm run test:integration` (exige Docker) · `npm run test:e2e` · `npm run typecheck` · `npm run lint` · `npm run build`.

---

## Estrutura de arquivos

**Criados**
- `src/lib/domain/metricas.ts` — tipos e as três funções puras. É o coração do plano.
- `src/lib/domain/metricas.test.ts`
- `supabase/migrations/0014_metricas.sql` — as duas RPCs.
- `tests/integration/0014_metricas.test.ts`
- `src/app/(app)/metricas/page.tsx` — server component, orquestra.
- `src/app/(app)/metricas/filtros.tsx` — client, período/pipeline/responsável.
- `src/app/(app)/metricas/funil.tsx` — apresentação, server.
- `src/app/(app)/metricas/etiquetas.tsx` — apresentação, server.
- `src/app/(app)/metricas/canais.tsx` — client, a árvore expansível.
- `tests/e2e/metricas.spec.ts`

**Modificados**
- `src/lib/data/store.ts` — `FiltroMetricas` e dois métodos no port.
- `src/lib/data/supabase.ts` — as duas chamadas de RPC.
- `src/lib/data/memory.ts` — as duas implementações in-memory.
- `src/app/(app)/layout.tsx:42-49` — o link de navegação.

---

### Task 1: Domínio — tipos e `funilDaCoorte`

**Files:**
- Create: `src/lib/domain/metricas.ts`
- Test: `src/lib/domain/metricas.test.ts`

**Interfaces:**
- Consumes: `Etapa`, `LeadOrigem`, `LeadStatus` de `@/lib/domain/tipos`; `Resultado`, `ok`, `falha` de `@/lib/domain/resultado`.
- Produces — as tasks 2 a 6 dependem destes nomes exatos:
  ```ts
  export type LinhaCoorte = {
    leadId: string
    criadoEm: Date
    origem: LeadOrigem
    status: LeadStatus
    responsavelId: string | null
    campanhaId: string | null
    campanhaNome: string | null
    conjuntoId: string | null
    conjuntoNome: string | null
    anuncioId: string | null
    anuncioNome: string | null
    ordemMax: number
  }
  export type DegrauFunil = {
    etapaId: string; nome: string; ordem: number
    alcancaram: number; percentualDoAnterior: number
  }
  export type Funil = {
    totalDaCoorte: number; degraus: DegrauFunil[]
    ganhos: number; perdidos: number; abertos: number
  }
  export function funilDaCoorte(linhas: LinhaCoorte[], etapas: Etapa[]): Funil
  ```

- [ ] **Step 1: Escrever os testes que falham**

```ts
// src/lib/domain/metricas.test.ts
import { describe, expect, it } from 'vitest'
import type { Etapa } from '@/lib/domain/tipos'
import { funilDaCoorte, type LinhaCoorte } from './metricas'

const ETAPAS: Etapa[] = [
  { id: 'e1', pipelineId: 'p', nome: 'Novo lead', ordem: 1, tipo: 'aberta', slaHoras: null },
  { id: 'e2', pipelineId: 'p', nome: 'Contato feito', ordem: 2, tipo: 'aberta', slaHoras: null },
  { id: 'e3', pipelineId: 'p', nome: 'Proposta', ordem: 3, tipo: 'aberta', slaHoras: null },
  { id: 'g', pipelineId: 'p', nome: 'Ganho', ordem: 6, tipo: 'ganho', slaHoras: null },
  { id: 'x', pipelineId: 'p', nome: 'Perdido', ordem: 7, tipo: 'perdido', slaHoras: null },
]

function linha(over: Partial<LinhaCoorte> = {}): LinhaCoorte {
  return {
    leadId: 'l1',
    criadoEm: new Date('2026-07-01T00:00:00Z'),
    origem: 'meta',
    status: 'aberto',
    responsavelId: null,
    campanhaId: null,
    campanhaNome: null,
    conjuntoId: null,
    conjuntoNome: null,
    anuncioId: null,
    anuncioNome: null,
    ordemMax: 1,
    ...over,
  }
}

describe('funilDaCoorte', () => {
  it('so monta degrau para etapa aberta — Ganho e Perdido saem da escala', () => {
    // Ganho tem ordem 6 e Perdido 7, MAIORES que toda etapa aberta. Se
    // entrassem na escala, todo lead perdido apareceria como tendo alcancado
    // o fundo do funil.
    const f = funilDaCoorte([linha()], ETAPAS)
    expect(f.degraus.map((d) => d.etapaId)).toEqual(['e1', 'e2', 'e3'])
  })

  it('lead que pulou etapa conta nos degraus que pulou', () => {
    // Arrastar de Novo lead direto para Proposta poe ordemMax em 3. O lead
    // atravessou o funil ate ali, e a etapa pulada nao pode parecer morta.
    const f = funilDaCoorte([linha({ ordemMax: 3 })], ETAPAS)
    expect(f.degraus.map((d) => d.alcancaram)).toEqual([1, 1, 1])
  })

  it('lead que voltou etapa mantem a profundidade que ja tinha alcancado', () => {
    // ordemMax e o MAXIMO ja ocupado, nao a posicao atual: voltar de Proposta
    // para Contato feito nao apaga que a proposta chegou a existir.
    const f = funilDaCoorte([linha({ ordemMax: 3 })], ETAPAS)
    expect(f.degraus[2]?.alcancaram).toBe(1)
  })

  it('lead que parou no degrau 2 nao aparece no 3', () => {
    const f = funilDaCoorte([linha({ ordemMax: 2 })], ETAPAS)
    expect(f.degraus.map((d) => d.alcancaram)).toEqual([1, 1, 0])
  })

  it('percentual e sobre o degrau anterior, e o primeiro e 100 de si mesmo', () => {
    const linhas = [
      linha({ leadId: 'a', ordemMax: 3 }),
      linha({ leadId: 'b', ordemMax: 2 }),
      linha({ leadId: 'c', ordemMax: 2 }),
      linha({ leadId: 'd', ordemMax: 1 }),
    ]
    const f = funilDaCoorte(linhas, ETAPAS)
    expect(f.degraus.map((d) => d.alcancaram)).toEqual([4, 3, 1])
    expect(f.degraus.map((d) => Math.round(d.percentualDoAnterior))).toEqual([100, 75, 33])
  })

  it('degrau anterior zerado nao vira NaN nem Infinity', () => {
    // Coorte inteira com ordemMax 0: dividir por zero produziria NaN, que a
    // UI renderizaria como "NaN%" sem nenhum teste reclamar.
    const f = funilDaCoorte([linha({ ordemMax: 0 })], ETAPAS)
    expect(f.degraus.map((d) => d.percentualDoAnterior)).toEqual([100, 0, 0])
    expect(f.degraus.every((d) => Number.isFinite(d.percentualDoAnterior))).toBe(true)
  })

  it('ordemMax 0 entra no total da coorte e em nenhum degrau', () => {
    // Estado de um lead criado direto em Ganho ou Perdido: nunca ocupou etapa
    // aberta. Some do funil, mas nao pode sumir da contagem da coorte.
    const f = funilDaCoorte([linha({ ordemMax: 0, status: 'perdido' })], ETAPAS)
    expect(f.totalDaCoorte).toBe(1)
    expect(f.degraus[0]?.alcancaram).toBe(0)
  })

  it('os desfechos saem de status, nao da etapa', () => {
    const linhas = [
      linha({ leadId: 'a', status: 'ganho', ordemMax: 3 }),
      linha({ leadId: 'b', status: 'perdido', ordemMax: 2 }),
      linha({ leadId: 'c', status: 'aberto', ordemMax: 1 }),
    ]
    const f = funilDaCoorte(linhas, ETAPAS)
    expect({ g: f.ganhos, p: f.perdidos, a: f.abertos }).toEqual({ g: 1, p: 1, a: 1 })
  })

  it('etapas fora de ordem no argumento saem ordenadas por ordem', () => {
    // pipelinePadrao() ordena hoje, mas o funil nao pode depender disso: uma
    // etapa reordenada pelo admin trocaria o sentido do funil em silencio.
    const embaralhadas = [ETAPAS[2]!, ETAPAS[0]!, ETAPAS[1]!]
    const f = funilDaCoorte([linha({ ordemMax: 3 })], embaralhadas)
    expect(f.degraus.map((d) => d.ordem)).toEqual([1, 2, 3])
  })

  it('coorte vazia devolve degraus zerados, nao lista vazia', () => {
    // A tela precisa desenhar o funil do pipeline mesmo sem lead nenhum,
    // senao conta nova mostra uma area em branco sem explicacao.
    const f = funilDaCoorte([], ETAPAS)
    expect(f.totalDaCoorte).toBe(0)
    expect(f.degraus).toHaveLength(3)
    expect(f.degraus.every((d) => d.alcancaram === 0)).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- src/lib/domain/metricas.test.ts`
Expected: FAIL — `Failed to resolve import "./metricas"`.

- [ ] **Step 3: Implementar**

```ts
// src/lib/domain/metricas.ts
import type { Etapa, LeadOrigem, LeadStatus } from '@/lib/domain/tipos'

/**
 * Uma linha por lead da coorte, como a RPC metricas_coorte devolve. O unico
 * campo derivado e `ordemMax`: a maior `ordem` entre etapas de tipo 'aberta'
 * que o lead ja ocupou. O SQL o calcula porque em TypeScript isso exigiria
 * trazer o stage_history inteiro; daqui para frente e tudo funcao pura.
 */
export type LinhaCoorte = {
  leadId: string
  criadoEm: Date
  origem: LeadOrigem
  status: LeadStatus
  responsavelId: string | null
  campanhaId: string | null
  campanhaNome: string | null
  conjuntoId: string | null
  conjuntoNome: string | null
  anuncioId: string | null
  anuncioNome: string | null
  /** 0 quando o lead nunca ocupou etapa aberta. */
  ordemMax: number
}

export type DegrauFunil = {
  etapaId: string
  nome: string
  ordem: number
  alcancaram: number
  /** Sobre o degrau anterior. O primeiro degrau e 100 de si mesmo. */
  percentualDoAnterior: number
}

export type Funil = {
  totalDaCoorte: number
  degraus: DegrauFunil[]
  ganhos: number
  perdidos: number
  abertos: number
}

/** Percentual que nunca vira NaN nem Infinity: base zero devolve zero. */
function porcentagem(parte: number, base: number): number {
  return base === 0 ? 0 : (parte / base) * 100
}

export function funilDaCoorte(linhas: LinhaCoorte[], etapas: Etapa[]): Funil {
  // Ganho e Perdido tem ordem MAIOR que toda etapa aberta no pipeline padrao
  // (6 e 7). Sem este filtro, todo lead perdido apareceria como tendo
  // alcancado o fundo do funil.
  const abertas = etapas.filter((e) => e.tipo === 'aberta').sort((a, b) => a.ordem - b.ordem)

  const degraus: DegrauFunil[] = []
  let anterior = 0
  for (const [i, etapa] of abertas.entries()) {
    const alcancaram = linhas.filter((l) => l.ordemMax >= etapa.ordem).length
    degraus.push({
      etapaId: etapa.id,
      nome: etapa.nome,
      ordem: etapa.ordem,
      percentualDoAnterior: i === 0 ? 100 : porcentagem(alcancaram, anterior),
      alcancaram,
    })
    anterior = alcancaram
  }

  return {
    totalDaCoorte: linhas.length,
    degraus,
    ganhos: linhas.filter((l) => l.status === 'ganho').length,
    perdidos: linhas.filter((l) => l.status === 'perdido').length,
    abertos: linhas.filter((l) => l.status === 'aberto').length,
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- src/lib/domain/metricas.test.ts && npm run typecheck`
Expected: PASS nos dois.

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/metricas.ts src/lib/domain/metricas.test.ts
git commit -m "feat: funil cumulativo por profundidade alcancada, em dominio puro"
```

---

### Task 2: Domínio — `etiquetasPorEtapa` e `canaisDaCoorte`

**Files:**
- Modify: `src/lib/domain/metricas.ts`
- Test: `src/lib/domain/metricas.test.ts`

**Interfaces:**
- Consumes: `LinhaCoorte` da Task 1.
- Produces:
  ```ts
  export type AplicacaoEtiqueta = {
    leadId: string; tagId: string; tagNome: string
    stageIdNoMomento: string; ordemNoMomento: number
  }
  export type LinhaEtiqueta = { tagId: string; nome: string; leads: number; percentual: number }
  export type RankingEtiquetas = { etapaId: string; denominador: number; linhas: LinhaEtiqueta[] }
  export function etiquetasPorEtapa(
    linhas: LinhaCoorte[], aplicacoes: AplicacaoEtiqueta[], etapa: Etapa,
  ): RankingEtiquetas

  export const SEM_CAMPANHA = '(sem campanha)'
  export const SEM_ANUNCIO = '(sem anúncio)'
  export type NoCanal = {
    chave: string; rotulo: string; ehId: boolean
    leads: number; ganhos: number; perdidos: number; abertos: number
    taxaGanho: number; filhos: NoCanal[]
  }
  export function canaisDaCoorte(linhas: LinhaCoorte[]): NoCanal[]
  ```

- [ ] **Step 1: Escrever os testes que falham**

Acrescente a `src/lib/domain/metricas.test.ts`, reusando `ETAPAS` e o helper `linha()` que já estão no arquivo:

```ts
import {
  canaisDaCoorte, etiquetasPorEtapa, SEM_ANUNCIO, SEM_CAMPANHA,
  type AplicacaoEtiqueta,
} from './metricas'

function aplic(over: Partial<AplicacaoEtiqueta> = {}): AplicacaoEtiqueta {
  return {
    leadId: 'l1', tagId: 't1', tagNome: 'Preço alto',
    stageIdNoMomento: 'e3', ordemNoMomento: 3, ...over,
  }
}

describe('etiquetasPorEtapa', () => {
  it('o denominador de etapa aberta e quem alcancou aquela etapa', () => {
    // E exatamente o numero que o funil mostra naquele degrau — as duas
    // visoes tem que concordar, senao a tela se contradiz.
    const linhas = [
      linha({ leadId: 'a', ordemMax: 3 }),
      linha({ leadId: 'b', ordemMax: 3 }),
      linha({ leadId: 'c', ordemMax: 1 }),
    ]
    const r = etiquetasPorEtapa(linhas, [aplic({ leadId: 'a' })], ETAPAS[2]!)
    expect(r.denominador).toBe(2)
    expect(r.linhas[0]).toMatchObject({ nome: 'Preço alto', leads: 1, percentual: 50 })
  })

  it('em etapa de ganho o denominador e o status, nao a ordem', () => {
    // Ganho tem ordem 6, fora da escala de ordemMax: usar ordem aqui daria
    // denominador zero e todo percentual sumiria.
    const linhas = [
      linha({ leadId: 'a', status: 'ganho', ordemMax: 3 }),
      linha({ leadId: 'b', status: 'aberto', ordemMax: 3 }),
    ]
    const r = etiquetasPorEtapa(
      linhas,
      [aplic({ leadId: 'a', stageIdNoMomento: 'g', ordemNoMomento: 6 })],
      ETAPAS[3]!,
    )
    expect(r.denominador).toBe(1)
    expect(r.linhas[0]?.percentual).toBe(100)
  })

  it('em etapa de perda o denominador e o status perdido', () => {
    const linhas = [
      linha({ leadId: 'a', status: 'perdido', ordemMax: 2 }),
      linha({ leadId: 'b', status: 'perdido', ordemMax: 1 }),
      linha({ leadId: 'c', status: 'ganho', ordemMax: 3 }),
    ]
    const r = etiquetasPorEtapa(
      linhas,
      [aplic({ leadId: 'a', stageIdNoMomento: 'x', ordemNoMomento: 7 })],
      ETAPAS[4]!,
    )
    expect(r.denominador).toBe(2)
    expect(r.linhas[0]?.percentual).toBe(50)
  })

  it('so conta aplicacao congelada NAQUELA etapa', () => {
    const linhas = [linha({ leadId: 'a', ordemMax: 3 })]
    const aplicacoes = [
      aplic({ leadId: 'a', tagId: 't1', tagNome: 'Na proposta', stageIdNoMomento: 'e3' }),
      aplic({ leadId: 'a', tagId: 't2', tagNome: 'No contato', stageIdNoMomento: 'e2' }),
    ]
    const r = etiquetasPorEtapa(linhas, aplicacoes, ETAPAS[2]!)
    expect(r.linhas.map((l) => l.nome)).toEqual(['Na proposta'])
  })

  it('conta lead distinto, nao aplicacao', () => {
    const linhas = [linha({ leadId: 'a', ordemMax: 3 }), linha({ leadId: 'b', ordemMax: 3 })]
    const aplicacoes = [
      aplic({ leadId: 'a', tagId: 't1' }),
      aplic({ leadId: 'b', tagId: 't1' }),
      aplic({ leadId: 'b', tagId: 't2', tagNome: 'Outra' }),
    ]
    const r = etiquetasPorEtapa(linhas, aplicacoes, ETAPAS[2]!)
    expect(r.linhas.find((l) => l.tagId === 't1')?.leads).toBe(2)
  })

  it('empate de contagem desempata por nome, sempre na mesma ordem', () => {
    // Empate de ordenacao ja produziu bug neste repo (backlog #10). Sem
    // desempate, duas cargas da mesma tela trocam as linhas de lugar.
    const linhas = [linha({ leadId: 'a', ordemMax: 3 })]
    const aplicacoes = [
      aplic({ leadId: 'a', tagId: 't2', tagNome: 'Zebra' }),
      aplic({ leadId: 'a', tagId: 't1', tagNome: 'Abacate' }),
    ]
    const r = etiquetasPorEtapa(linhas, aplicacoes, ETAPAS[2]!)
    expect(r.linhas.map((l) => l.nome)).toEqual(['Abacate', 'Zebra'])
  })

  it('denominador zero nao vira NaN', () => {
    const r = etiquetasPorEtapa([], [], ETAPAS[2]!)
    expect(r.denominador).toBe(0)
    expect(r.linhas).toEqual([])
  })

  it('aplicacao de lead fora da coorte e ignorada', () => {
    // Defesa de borda: as duas RPCs usam o mesmo filtro, mas se um dia
    // divergirem o percentual passaria de 100 sem nada reclamar.
    const linhas = [linha({ leadId: 'a', ordemMax: 3 })]
    const r = etiquetasPorEtapa(linhas, [aplic({ leadId: 'forasteiro' })], ETAPAS[2]!)
    expect(r.linhas).toEqual([])
  })
})

describe('canaisDaCoorte', () => {
  it('agrupa por origem, depois campanha, depois anuncio', () => {
    const linhas = [
      linha({ leadId: 'a', origem: 'meta', campanhaId: 'c1', campanhaNome: 'Black', anuncioId: 'a1', anuncioNome: 'Video' }),
      linha({ leadId: 'b', origem: 'google', campanhaId: 'c9' }),
    ]
    const canais = canaisDaCoorte(linhas)
    expect(canais.map((c) => c.chave)).toEqual(['meta', 'google'])
    expect(canais[0]?.filhos[0]?.rotulo).toBe('Black')
    expect(canais[0]?.filhos[0]?.filhos[0]?.rotulo).toBe('Video')
  })

  it('renomear campanha nao parte o historico: agrupa por id, exibe o nome mais recente', () => {
    // O motivo de existirem pares id/nome. Sem isso, "Black Nov" e
    // "Black Nov v2" virariam duas linhas para a mesma campanha.
    const linhas = [
      linha({ leadId: 'a', campanhaId: 'c1', campanhaNome: 'Black Nov', criadoEm: new Date('2026-07-01T00:00:00Z') }),
      linha({ leadId: 'b', campanhaId: 'c1', campanhaNome: 'Black Nov v2', criadoEm: new Date('2026-07-20T00:00:00Z') }),
    ]
    const campanhas = canaisDaCoorte(linhas)[0]!.filhos
    expect(campanhas).toHaveLength(1)
    expect(campanhas[0]).toMatchObject({ rotulo: 'Black Nov v2', leads: 2, ehId: false })
  })

  it('id sem nome nenhum exibe o id, marcado como id', () => {
    // Caso permanente do Google: o payload traz so numeros, e resolver nome
    // exigiria a Google Ads API. A tela mostra o id rotulado como id, nunca
    // um numero numa coluna chamada "nome".
    const linhas = [linha({ origem: 'google', campanhaId: '123456789', campanhaNome: null })]
    const c = canaisDaCoorte(linhas)[0]!.filhos[0]!
    expect(c).toMatchObject({ rotulo: '123456789', ehId: true })
  })

  it('nome nulo numa linha nao apaga o nome que outra linha do mesmo id trouxe', () => {
    const linhas = [
      linha({ leadId: 'a', campanhaId: 'c1', campanhaNome: 'Black', criadoEm: new Date('2026-07-01T00:00:00Z') }),
      linha({ leadId: 'b', campanhaId: 'c1', campanhaNome: null, criadoEm: new Date('2026-07-20T00:00:00Z') }),
    ]
    const c = canaisDaCoorte(linhas)[0]!.filhos[0]!
    expect(c).toMatchObject({ rotulo: 'Black', ehId: false, leads: 2 })
  })

  it('id nulo vira grupo explicito e continua contando no canal', () => {
    // Estado real: lead manual, e lead do Meta cuja arvore do anuncio falhou.
    // Somir com ele faria a soma dos filhos nao bater com o pai.
    const linhas = [
      linha({ leadId: 'a', origem: 'meta', campanhaId: 'c1' }),
      linha({ leadId: 'b', origem: 'meta', campanhaId: null }),
    ]
    const meta = canaisDaCoorte(linhas)[0]!
    expect(meta.leads).toBe(2)
    expect(meta.filhos.map((f) => f.chave)).toContain(SEM_CAMPANHA)
    expect(meta.filhos.reduce((s, f) => s + f.leads, 0)).toBe(meta.leads)
  })

  it('campanha conhecida com anuncio nulo vira (sem anúncio)', () => {
    const linhas = [linha({ campanhaId: 'c1', anuncioId: null })]
    const campanha = canaisDaCoorte(linhas)[0]!.filhos[0]!
    expect(campanha.filhos.map((f) => f.chave)).toEqual([SEM_ANUNCIO])
  })

  it('taxa de ganho e ganhos sobre leads, com os abertos no denominador', () => {
    const linhas = [
      linha({ leadId: 'a', status: 'ganho' }),
      linha({ leadId: 'b', status: 'perdido' }),
      linha({ leadId: 'c', status: 'aberto' }),
      linha({ leadId: 'd', status: 'aberto' }),
    ]
    const c = canaisDaCoorte(linhas)[0]!
    expect(c).toMatchObject({ leads: 4, ganhos: 1, perdidos: 1, abertos: 2, taxaGanho: 25 })
  })

  it('ordena por leads decrescente, desempatando por rotulo', () => {
    const linhas = [
      linha({ leadId: 'a', origem: 'google' }),
      linha({ leadId: 'b', origem: 'meta' }),
      linha({ leadId: 'c', origem: 'manual' }),
      linha({ leadId: 'd', origem: 'manual' }),
    ]
    expect(canaisDaCoorte(linhas).map((c) => c.chave)).toEqual(['manual', 'google', 'meta'])
  })

  it('coorte vazia devolve lista vazia', () => {
    expect(canaisDaCoorte([])).toEqual([])
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- src/lib/domain/metricas.test.ts`
Expected: FAIL — os testes do funil continuam verdes; os novos falham por `etiquetasPorEtapa is not a function` / import não resolvido.

- [ ] **Step 3: Implementar**

Acrescente a `src/lib/domain/metricas.ts`:

```ts
export type AplicacaoEtiqueta = {
  leadId: string
  tagId: string
  tagNome: string
  stageIdNoMomento: string
  ordemNoMomento: number
}

export type LinhaEtiqueta = { tagId: string; nome: string; leads: number; percentual: number }

export type RankingEtiquetas = { etapaId: string; denominador: number; linhas: LinhaEtiqueta[] }

/**
 * Quantos leads da coorte "chegaram" nesta etapa. Para etapa aberta e a mesma
 * profundidade que o funil usa — as duas visoes tem que dar o mesmo numero.
 * Para Ganho e Perdido, ordem nao serve (elas estao fora da escala de
 * ordemMax): quem chegou la e quem terminou naquele status.
 */
function chegaramNaEtapa(linhas: LinhaCoorte[], etapa: Etapa): LinhaCoorte[] {
  if (etapa.tipo === 'ganho') return linhas.filter((l) => l.status === 'ganho')
  if (etapa.tipo === 'perdido') return linhas.filter((l) => l.status === 'perdido')
  return linhas.filter((l) => l.ordemMax >= etapa.ordem)
}

export function etiquetasPorEtapa(
  linhas: LinhaCoorte[],
  aplicacoes: AplicacaoEtiqueta[],
  etapa: Etapa,
): RankingEtiquetas {
  const naCoorte = new Set(linhas.map((l) => l.leadId))
  const chegaram = chegaramNaEtapa(linhas, etapa)
  const denominador = chegaram.length

  // Set por tag: a mesma pessoa nao pode contar duas vezes. Hoje a PK de
  // lead_tags ja impede aplicacao repetida, mas o numero que a tela mostra e
  // "quantos LEADS", e essa frase nao pode depender daquela constraint.
  const leadsPorTag = new Map<string, { nome: string; leads: Set<string> }>()
  for (const a of aplicacoes) {
    if (a.stageIdNoMomento !== etapa.id) continue
    if (!naCoorte.has(a.leadId)) continue
    const atual = leadsPorTag.get(a.tagId) ?? { nome: a.tagNome, leads: new Set<string>() }
    atual.leads.add(a.leadId)
    leadsPorTag.set(a.tagId, atual)
  }

  const linhasRanking: LinhaEtiqueta[] = [...leadsPorTag.entries()].map(([tagId, v]) => ({
    tagId,
    nome: v.nome,
    leads: v.leads.size,
    percentual: porcentagem(v.leads.size, denominador),
  }))
  // Desempate por nome: sem ele, duas cargas da mesma tela podem trocar as
  // linhas de lugar (backlog #10 foi exatamente essa classe).
  linhasRanking.sort((a, b) => b.leads - a.leads || a.nome.localeCompare(b.nome, 'pt-BR'))

  return { etapaId: etapa.id, denominador, linhas: linhasRanking }
}

export const SEM_CAMPANHA = '(sem campanha)'
export const SEM_ANUNCIO = '(sem anúncio)'

export type NoCanal = {
  chave: string
  rotulo: string
  /** true quando nao ha nome conhecido e o rotulo e o id cru — a tela marca. */
  ehId: boolean
  leads: number
  ganhos: number
  perdidos: number
  abertos: number
  taxaGanho: number
  filhos: NoCanal[]
}

/** Nome do lead mais recente que trouxe um nome para este id. Linha sem nome
 * nao apaga o nome que outra trouxe, e renomear no gerenciador do Meta so
 * troca o rotulo — nunca parte o grupo em dois. */
function rotuloMaisRecente(linhas: LinhaCoorte[], nomeDe: (l: LinhaCoorte) => string | null) {
  let escolhido: { nome: string; em: Date } | null = null
  for (const l of linhas) {
    const nome = nomeDe(l)
    if (!nome) continue
    if (!escolhido || l.criadoEm > escolhido.em) escolhido = { nome, em: l.criadoEm }
  }
  return escolhido?.nome ?? null
}

function agrupar(
  linhas: LinhaCoorte[],
  idDe: (l: LinhaCoorte) => string | null,
  nomeDe: (l: LinhaCoorte) => string | null,
  sentinela: string,
  filhosDe: (grupo: LinhaCoorte[]) => NoCanal[],
): NoCanal[] {
  const grupos = new Map<string, LinhaCoorte[]>()
  for (const l of linhas) {
    const chave = idDe(l) ?? sentinela
    grupos.set(chave, [...(grupos.get(chave) ?? []), l])
  }

  const nos = [...grupos.entries()].map(([chave, grupo]) => {
    const nome = chave === sentinela ? null : rotuloMaisRecente(grupo, nomeDe)
    const ganhos = grupo.filter((l) => l.status === 'ganho').length
    return {
      chave,
      rotulo: nome ?? chave,
      ehId: chave !== sentinela && nome === null,
      leads: grupo.length,
      ganhos,
      perdidos: grupo.filter((l) => l.status === 'perdido').length,
      abertos: grupo.filter((l) => l.status === 'aberto').length,
      taxaGanho: porcentagem(ganhos, grupo.length),
      filhos: filhosDe(grupo),
    }
  })
  nos.sort((a, b) => b.leads - a.leads || a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
  return nos
}

export function canaisDaCoorte(linhas: LinhaCoorte[]): NoCanal[] {
  return agrupar(
    linhas,
    (l) => l.origem,
    (l) => l.origem,
    // Origem e enum not null: a sentinela nunca e alcancada neste nivel.
    '(sem origem)',
    (doCanal) =>
      agrupar(
        doCanal,
        (l) => l.campanhaId,
        (l) => l.campanhaNome,
        SEM_CAMPANHA,
        (daCampanha) =>
          agrupar(daCampanha, (l) => l.anuncioId, (l) => l.anuncioNome, SEM_ANUNCIO, () => []),
      ),
  )
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- src/lib/domain/metricas.test.ts && npm run typecheck && npm run lint`
Expected: PASS nos três.

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/metricas.ts src/lib/domain/metricas.test.ts
git commit -m "feat: ranking de etiquetas por etapa e arvore de canais ate o anuncio"
```

---

### Task 3: Migration `0014` — as duas RPCs

**Files:**
- Create: `supabase/migrations/0014_metricas.sql`
- Test: `tests/integration/0014_metricas.test.ts`

**Interfaces:**
- Produces, consumido pela Task 4:
  - `public.metricas_coorte(p_pipeline_id uuid, p_de timestamptz, p_ate timestamptz, p_responsavel_id uuid default null)` → `table(lead_id uuid, criado_em timestamptz, origem lead_origem, status lead_status, responsavel_id uuid, campanha_id text, campanha_nome text, conjunto_id text, conjunto_nome text, anuncio_id text, anuncio_nome text, ordem_max integer)`
  - `public.metricas_etiquetas(mesmos argumentos)` → `table(lead_id uuid, tag_id uuid, tag_nome text, stage_id_no_momento uuid, ordem_no_momento integer)`

**Sobre os `// ...` no código de teste abaixo — são deliberados, não lacunas.** As asserções estão completas; o que está elidido é só a semeadura, e o único jeito certo de preenchê-la é **copiando do arquivo vizinho**, não do plano. `cli`, `montarCenario` e os helpers são os que `tests/integration/helpers/` já expõe; abra `tests/integration/0013_rastreamento.test.ts` e reuse os nomes e o `beforeEach` dele. Duplicar semeadura foi achado de review no plano anterior, e transcrever 200 linhas de setup para dentro de um documento que nenhum compilador lê é a classe de defeito que mais custou a este projeto.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// tests/integration/0014_metricas.test.ts

  it('ordem_max e a maior etapa ABERTA ja ocupada, e lead perdido nao herda a ordem de Perdido', () => {
    // Perdido tem ordem 7, maior que toda etapa aberta. Sem o filtro por
    // tipo, todo lead perdido apareceria no fundo do funil.
    // ... crie um lead, mova para 'Contato feito' (ordem 2), depois para
    // 'Perdido' com motivo, e chame metricas_coorte ...
    expect(linha.ordem_max).toBe(2)
  })

  it('lead que pulou etapa reporta a ordem do destino', () => {
    // ... crie um lead em 'Novo lead' e mova direto para 'Proposta' (ordem 4) ...
    expect(linha.ordem_max).toBe(4)
  })

  it('lead que voltou etapa mantem a ordem maxima ja alcancada', () => {
    // Prova que a uniao le stage_origem tambem: depois de voltar, nem o
    // stage_id atual nem o ultimo stage_destino valem 4.
    // ... mova ate 'Proposta' (4) e depois de volta para 'Contato feito' (2) ...
    expect(linha.ordem_max).toBe(4)
  })

  it('lead sem movimento nenhum reporta a ordem da etapa em que nasceu', () => {
    // Lead manual nao gera stage_history: a uniao tem que incluir o stage_id
    // atual, senao todo lead recem-criado sairia com ordem_max 0.
    expect(linha.ordem_max).toBe(1)
  })

  it('a coorte e semiaberta em criado_em: [de, ate)', () => {
    // Dois periodos adjacentes nunca podem contar o mesmo lead duas vezes.
    // ... crie um lead com criado_em exatamente igual a `ate` e outro igual a
    // `de`; chame com [de, ate) ...
    expect(ids).toContain(leadEmDe)
    expect(ids).not.toContain(leadEmAte)
  })

  it('vendedor so recebe a coorte dele, e o admin recebe a conta inteira', () => {
    // O teste que nao se abre mao: este projeto ja corrigiu duas falhas de
    // isolamento entre contas. As duas chamadas usam os MESMOS argumentos —
    // a unica diferenca e quem chama. Sem a RLS, os dois numeros seriam iguais.
    // ... semeie um lead do vendedor A e um do vendedor B; chame como A e
    // como admin ...
    expect(comoVendedor).toHaveLength(1)
    expect(comoAdmin).toHaveLength(2)
  })

  it('metricas_etiquetas devolve a etapa congelada e a ordem dela', () => {
    // ... aplique uma etiqueta com o lead em 'Proposta' (ordem 4) ...
    expect(linha).toMatchObject({ tag_nome: 'Preço alto', ordem_no_momento: 4 })
  })

  it('metricas_etiquetas respeita a mesma janela e o mesmo recorte de RLS', () => {
    // ... etiqueta num lead fora da janela nao aparece; etiqueta em lead de
    // outro vendedor nao aparece para o vendedor ...
  })

  it('as duas funcoes sao security invoker', () => {
    // security definer aqui desligaria a RLS e devolveria a conta inteira
    // para qualquer chamador. E uma letra de diferenca no DDL.
    const r = await cli.query<{ proname: string; prosecdef: boolean }>(
      `select proname, prosecdef from pg_proc
        where pronamespace = 'public'::regnamespace
          and proname in ('metricas_coorte', 'metricas_etiquetas')`,
    )
    expect(r.rows).toHaveLength(2)
    expect(r.rows.every((x) => x.prosecdef === false)).toBe(true)
  })

  it('authenticated tem execute nas duas', () => {
    // O default ACL do schema public nesta imagem nao concede execute: sem
    // grant explicito a chamada morre em permission denied.
    const r = await cli.query<{ proname: string; pode: boolean }>(
      `select proname, has_function_privilege('authenticated', oid, 'execute') as pode
         from pg_proc
        where pronamespace = 'public'::regnamespace
          and proname in ('metricas_coorte', 'metricas_etiquetas')`,
    )
    expect(r.rows.every((x) => x.pode)).toBe(true)
  })
```

Preencha os trechos `// ...` com a semeadura real do arquivo vizinho. Para as chamadas com papel de vendedor, use o mesmo mecanismo de troca de papel/JWT que `tests/integration/0003_leads.test.ts` já usa para exercitar RLS — não invente um novo.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:integration -- tests/integration/0014_metricas.test.ts`
Expected: FAIL — `function public.metricas_coorte(...) does not exist`.

- [ ] **Step 3: Escrever a migration**

```sql
-- supabase/migrations/0014_metricas.sql
--
-- Sub-projeto 3, Plano 6: as duas leituras que a aba de Metricas consome.
--
-- SECURITY INVOKER de proposito, nos dois casos. A aba e visivel para os tres
-- papeis, e o recorte por papel e exatamente o que pode_ver_lead ja faz no
-- funil: vendedor so enxerga o que e dele. Marcar como definer aqui desligaria
-- a RLS e devolveria a conta inteira para qualquer chamador — uma letra de
-- diferenca no DDL, sem nenhum erro visivel.
--
-- O que estas funcoes fazem e o que so o SQL faz bem: reduzir stage_history a
-- um numero por lead. Toda regra de negocio (degraus, denominadores,
-- agrupamento por id, nome mais recente) fica em dominio puro, onde o teste
-- roda em milissegundos e sem Docker.

create or replace function public.metricas_coorte(
  p_pipeline_id uuid,
  p_de timestamptz,
  p_ate timestamptz,
  p_responsavel_id uuid default null
)
returns table (
  lead_id uuid,
  criado_em timestamptz,
  origem public.lead_origem,
  status public.lead_status,
  responsavel_id uuid,
  campanha_id text,
  campanha_nome text,
  conjunto_id text,
  conjunto_nome text,
  anuncio_id text,
  anuncio_nome text,
  ordem_max integer
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    l.id,
    l.criado_em,
    l.origem,
    l.status,
    l.responsavel_id,
    l.campanha_id,
    l.campanha_nome,
    l.conjunto_id,
    l.conjunto_nome,
    l.anuncio_id,
    l.anuncio_nome,
    -- A uniao das etapas que o lead JA ocupou: o stage_id atual, mais toda
    -- origem e todo destino do historico. Ela e completa sem backfill nenhum
    -- — move_lead_stage e o unico caminho de troca de etapa e sempre grava
    -- historico, entao a etapa inicial de um lead que se moveu aparece como
    -- stage_origem do primeiro movimento, e a de um lead que nunca se moveu e
    -- o proprio stage_id.
    --
    -- `s.tipo = 'aberta'` NAO e detalhe: Ganho e Perdido tem ordem 6 e 7 no
    -- pipeline padrao, maiores que toda etapa aberta. Sem o filtro, todo lead
    -- perdido sairia com a profundidade maxima do funil.
    --
    -- coalesce 0: lead que nunca ocupou etapa aberta entra no total da coorte
    -- e em nenhum degrau.
    coalesce((
      select max(s.ordem)
        from public.stages s
       where s.tipo = 'aberta'
         and s.pipeline_id = l.pipeline_id
         and (
           s.id = l.stage_id
           or exists (
             select 1
               from public.stage_history sh
              where sh.lead_id = l.id
                and (sh.stage_origem = s.id or sh.stage_destino = s.id)
           )
         )
    ), 0)::integer
  from public.leads l
  where l.pipeline_id = p_pipeline_id
    -- Semiaberto: dois periodos adjacentes nunca contam o mesmo lead duas vezes.
    and l.criado_em >= p_de
    and l.criado_em < p_ate
    and (p_responsavel_id is null or l.responsavel_id = p_responsavel_id);
$$;

create or replace function public.metricas_etiquetas(
  p_pipeline_id uuid,
  p_de timestamptz,
  p_ate timestamptz,
  p_responsavel_id uuid default null
)
returns table (
  lead_id uuid,
  tag_id uuid,
  tag_nome text,
  stage_id_no_momento uuid,
  ordem_no_momento integer
)
language sql
stable
security invoker
set search_path = public
as $$
  select lt.lead_id, t.id, t.nome, lt.stage_id_no_momento, s.ordem
    from public.lead_tags lt
    join public.tags t on t.id = lt.tag_id
    join public.stages s on s.id = lt.stage_id_no_momento
    join public.leads l on l.id = lt.lead_id
   where l.pipeline_id = p_pipeline_id
     and l.criado_em >= p_de
     and l.criado_em < p_ate
     and (p_responsavel_id is null or l.responsavel_id = p_responsavel_id);
$$;

-- Grant explicito: o default ACL do schema public nesta imagem (Postgres 17.6)
-- concede a anon/authenticated apenas Dxtm. Sem isto a chamada morre em
-- permission denied antes de a RLS ser sequer avaliada.
grant execute on function public.metricas_coorte(uuid, timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public.metricas_etiquetas(uuid, timestamptz, timestamptz, uuid) to authenticated;
```

- [ ] **Step 4: Aplicar e rodar**

Run: `npx supabase db reset && npm run test:integration`
Expected: as 14 migrations aplicam; a suíte de integração inteira passa.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0014_metricas.sql tests/integration/0014_metricas.test.ts
git commit -m "feat: RPCs de metricas, security invoker, com a profundidade por lead"
```

---

### Task 4: Port e as duas implementações

**Files:**
- Modify: `src/lib/data/store.ts`
- Modify: `src/lib/data/supabase.ts`
- Modify: `src/lib/data/memory.ts`
- Test: `src/lib/data/memory.test.ts`, `tests/integration/0014_metricas.test.ts`

**Interfaces:**
- Consumes: `LinhaCoorte` e `AplicacaoEtiqueta` das Tasks 1-2; as duas RPCs da Task 3.
- Produces, consumido pela Task 5:
  ```ts
  export type FiltroMetricas = {
    pipelineId: string
    de: Date
    ate: Date
    responsavelId?: string | null
  }
  // em CrmStore:
  metricasDaCoorte(f: FiltroMetricas): Promise<Resultado<LinhaCoorte[]>>
  etiquetasDaCoorte(f: FiltroMetricas): Promise<Resultado<AplicacaoEtiqueta[]>>
  ```

- [ ] **Step 1: Escrever os testes que falham**

Em `src/lib/data/memory.test.ts`, seguindo o padrão de semeadura que o arquivo já usa:

```ts
  it('metricasDaCoorte devolve uma linha por lead da janela, com a profundidade', async () => {
    // ... semeie a conta, crie um lead e mova-o uma etapa ...
    const r = await store.metricasDaCoorte({ pipelineId, de, ate })
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('deveria ter dado certo')
    expect(r.valor).toHaveLength(1)
    expect(r.valor[0]?.ordemMax).toBe(2)
  })

  it('metricasDaCoorte recorta pela janela semiaberta', async () => {
    // ... crie leads dentro e fora ...
  })

  it('etiquetasDaCoorte devolve a etapa congelada de cada aplicacao', async () => {
    // ... aplique uma etiqueta e verifique stageIdNoMomento/ordemNoMomento ...
  })
```

E em `tests/integration/0014_metricas.test.ts`, um caso que exercita o `SupabaseCrmStore` de verdade contra o Postgres, para provar que o mapeamento snake_case → camelCase não perdeu campo:

```ts
  it('SupabaseCrmStore.metricasDaCoorte mapeia todos os doze campos', () => {
    // ... ingira um lead com rastreamento completo, chame pelo store ...
    expect(Object.keys(linha).sort()).toEqual([
      'anuncioId', 'anuncioNome', 'campanhaId', 'campanhaNome', 'conjuntoId',
      'conjuntoNome', 'criadoEm', 'leadId', 'ordemMax', 'origem',
      'responsavelId', 'status',
    ])
    expect(linha.criadoEm).toBeInstanceOf(Date)
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- src/lib/data/memory.test.ts`
Expected: FAIL — `store.metricasDaCoorte is not a function`.

- [ ] **Step 3: Estender o port**

Em `src/lib/data/store.ts`, importe os dois tipos e acrescente:

```ts
import type { AplicacaoEtiqueta, LinhaCoorte } from '@/lib/domain/metricas'

export type FiltroMetricas = {
  pipelineId: string
  /** Inclusivo. */
  de: Date
  /** EXCLUSIVO: dois periodos adjacentes nao contam o mesmo lead duas vezes. */
  ate: Date
  responsavelId?: string | null
}
```

e, dentro de `interface CrmStore`:

```ts
  metricasDaCoorte(f: FiltroMetricas): Promise<Resultado<LinhaCoorte[]>>
  etiquetasDaCoorte(f: FiltroMetricas): Promise<Resultado<AplicacaoEtiqueta[]>>
```

- [ ] **Step 4: Implementar em `supabase.ts`**

```ts
  async metricasDaCoorte(f: FiltroMetricas): Promise<Resultado<LinhaCoorte[]>> {
    const { data, error } = await this.cliente.rpc('metricas_coorte', {
      p_pipeline_id: f.pipelineId,
      p_de: f.de.toISOString(),
      p_ate: f.ate.toISOString(),
      p_responsavel_id: f.responsavelId ?? null,
    })
    if (error) return falha(codigoDoErroPostgres(error))
    const linhas = (data ?? []) as {
      lead_id: string
      criado_em: string
      origem: Lead['origem']
      status: Lead['status']
      responsavel_id: string | null
      campanha_id: string | null
      campanha_nome: string | null
      conjunto_id: string | null
      conjunto_nome: string | null
      anuncio_id: string | null
      anuncio_nome: string | null
      ordem_max: number
    }[]
    return ok(
      linhas.map((l) => ({
        leadId: l.lead_id,
        criadoEm: new Date(l.criado_em),
        origem: l.origem,
        status: l.status,
        responsavelId: l.responsavel_id,
        campanhaId: l.campanha_id,
        campanhaNome: l.campanha_nome,
        conjuntoId: l.conjunto_id,
        conjuntoNome: l.conjunto_nome,
        anuncioId: l.anuncio_id,
        anuncioNome: l.anuncio_nome,
        ordemMax: l.ordem_max,
      })),
    )
  }

  async etiquetasDaCoorte(f: FiltroMetricas): Promise<Resultado<AplicacaoEtiqueta[]>> {
    const { data, error } = await this.cliente.rpc('metricas_etiquetas', {
      p_pipeline_id: f.pipelineId,
      p_de: f.de.toISOString(),
      p_ate: f.ate.toISOString(),
      p_responsavel_id: f.responsavelId ?? null,
    })
    if (error) return falha(codigoDoErroPostgres(error))
    const linhas = (data ?? []) as {
      lead_id: string
      tag_id: string
      tag_nome: string
      stage_id_no_momento: string
      ordem_no_momento: number
    }[]
    return ok(
      linhas.map((l) => ({
        leadId: l.lead_id,
        tagId: l.tag_id,
        tagNome: l.tag_nome,
        stageIdNoMomento: l.stage_id_no_momento,
        ordemNoMomento: l.ordem_no_momento,
      })),
    )
  }
```

- [ ] **Step 5: Implementar em `memory.ts`**

O in-memory precisa reproduzir a mesma regra de profundidade. Ele já guarda `leads`, `etapas`, `tags` e `leadTags`, mas **não guarda histórico de etapas** — verificado: a classe tem `conta`, `usuarioAtual`, `membrosLista`, `pipeline`, `etapas`, `motivos`, `leads`, `tags`, `leadTags` e `eventos`, e nada mais.

Acrescente o campo, e alimente-o em `moverEtapa`:

```ts
  /** Espelha stage_history. Sem ele, ordemMax so enxergaria a etapa atual e
   * lead que voltou de etapa perderia a profundidade que ja alcancou. */
  private movimentos: { leadId: string; origem: string | null; destino: string }[] = []
```

Não simule RLS: a nota no topo do arquivo já diz que isso só o Postgres testa.

```ts
  async metricasDaCoorte(f: FiltroMetricas): Promise<Resultado<LinhaCoorte[]>> {
    const ordemDe = new Map(this.etapas.map((e) => [e.id, e]))
    const linhas = this.leads
      .filter(
        (l) =>
          l.pipelineId === f.pipelineId &&
          l.criadoEm >= f.de &&
          l.criadoEm < f.ate &&
          (f.responsavelId == null || l.responsavelId === f.responsavelId),
      )
      .map((l) => {
        // Mesma uniao do SQL: stage atual + toda origem e destino do
        // historico, filtrando so etapa aberta.
        const ocupadas = new Set<string>([l.stageId])
        for (const m of this.movimentos.filter((m) => m.leadId === l.id)) {
          if (m.origem) ocupadas.add(m.origem)
          ocupadas.add(m.destino)
        }
        const ordens = [...ocupadas]
          .map((id) => ordemDe.get(id))
          .filter((e) => e?.tipo === 'aberta')
          .map((e) => e!.ordem)
        return {
          leadId: l.id,
          criadoEm: l.criadoEm,
          origem: l.origem,
          status: l.status,
          responsavelId: l.responsavelId,
          campanhaId: null,
          campanhaNome: null,
          conjuntoId: null,
          conjuntoNome: null,
          anuncioId: null,
          anuncioNome: null,
          ordemMax: ordens.length > 0 ? Math.max(...ordens) : 0,
        }
      })
    return ok(linhas)
  }

  async etiquetasDaCoorte(f: FiltroMetricas): Promise<Resultado<AplicacaoEtiqueta[]>> {
    const ordemDe = new Map(this.etapas.map((e) => [e.id, e.ordem]))
    const naJanela = new Set(
      this.leads
        .filter(
          (l) =>
            l.pipelineId === f.pipelineId &&
            l.criadoEm >= f.de &&
            l.criadoEm < f.ate &&
            (f.responsavelId == null || l.responsavelId === f.responsavelId),
        )
        .map((l) => l.id),
    )
    const porId = new Map(this.tags.map((t) => [t.id, t.nome]))
    return ok(
      this.leadTags
        .filter((lt) => naJanela.has(lt.leadId))
        .map((lt) => ({
          leadId: lt.leadId,
          tagId: lt.tagId,
          tagNome: porId.get(lt.tagId) ?? '',
          stageIdNoMomento: lt.stageIdNoMomento,
          ordemNoMomento: ordemDe.get(lt.stageIdNoMomento) ?? 0,
        })),
    )
  }
```

Nota para o implementador: `campanhaId` e os outros cinco saem nulos no in-memory porque `criarLead` in-memory só cria lead manual, que não tem rastreamento. Se a classe passar a semear lead com rastreamento, preencha-os — mas não invente campo no `Lead` só para isso.

- [ ] **Step 6: Rodar tudo**

Run: `npm test && npm run typecheck && npm run lint && npm run test:integration`
Expected: verde.

- [ ] **Step 7: Commit**

```bash
git add src/lib/data src/lib/domain tests/integration
git commit -m "feat: port de metricas com as duas implementacoes"
```

---

### Task 5: A tela `/metricas`

**Files:**
- Create: `src/app/(app)/metricas/page.tsx`, `filtros.tsx`, `funil.tsx`, `etiquetas.tsx`, `canais.tsx`
- Modify: `src/app/(app)/layout.tsx:42-49`
- Modify: `src/lib/domain/metricas.ts` (a interpretação do período)
- Test: `src/lib/domain/metricas.test.ts`

**Interfaces:**
- Consumes: `funilDaCoorte`, `etiquetasPorEtapa`, `canaisDaCoorte`, `SEM_CAMPANHA`, `SEM_ANUNCIO` e os tipos; `metricasDaCoorte`/`etiquetasDaCoorte` do port; `criarStoreDoServidor()` de `@/lib/data/supabase`, que devolve `Resultado<{ store, papel, conta, ... }>`.
- Produces: `export function interpretarPeriodo(params: { dias?: string; de?: string; ate?: string }, agora: Date): Resultado<{ de: Date; ate: Date }>`.

- [ ] **Step 1: Escrever os testes do período**

```ts
describe('interpretarPeriodo', () => {
  const AGORA = new Date('2026-08-01T12:00:00Z')

  it('sem parametro nenhum, usa os ultimos 30 dias', () => {
    const r = interpretarPeriodo({}, AGORA)
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('deveria ter dado certo')
    expect(r.valor.ate).toEqual(AGORA)
    expect(r.valor.de).toEqual(new Date('2026-07-02T12:00:00Z'))
  })

  it('dias=7 recorta sete dias', () => {
    const r = interpretarPeriodo({ dias: '7' }, AGORA)
    if (!r.ok) throw new Error('deveria ter dado certo')
    expect(r.valor.de).toEqual(new Date('2026-07-25T12:00:00Z'))
  })

  it('intervalo customizado vence dias', () => {
    const r = interpretarPeriodo({ dias: '7', de: '2026-01-01', ate: '2026-02-01' }, AGORA)
    if (!r.ok) throw new Error('deveria ter dado certo')
    expect(r.valor.de).toEqual(new Date('2026-01-01T00:00:00.000Z'))
  })

  it('de depois de ate e periodo_invalido', () => {
    const r = interpretarPeriodo({ de: '2026-02-01', ate: '2026-01-01' }, AGORA)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('deveria ter falhado')
    expect(r.erro).toBe('periodo_invalido')
  })

  it('de igual a ate e periodo_invalido: a janela e semiaberta e nao pegaria nada', () => {
    const r = interpretarPeriodo({ de: '2026-01-01', ate: '2026-01-01' }, AGORA)
    expect(r.ok).toBe(false)
  })

  it('dias que nao e numero cai no padrao em vez de estourar', () => {
    // O parametro vem da URL: o usuario pode digitar qualquer coisa.
    const r = interpretarPeriodo({ dias: 'abc' }, AGORA)
    if (!r.ok) throw new Error('deveria ter dado certo')
    expect(r.valor.de).toEqual(new Date('2026-07-02T12:00:00Z'))
  })

  it('data mal formada e periodo_invalido, nunca Invalid Date silencioso', () => {
    const r = interpretarPeriodo({ de: 'ontem', ate: '2026-02-01' }, AGORA)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('deveria ter falhado')
    expect(r.erro).toBe('periodo_invalido')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- src/lib/domain/metricas.test.ts`
Expected: FAIL — `interpretarPeriodo` não existe.

- [ ] **Step 3: Implementar `interpretarPeriodo`**

Em `src/lib/domain/metricas.ts` (importe `ok`, `falha`, `type Resultado` de `@/lib/domain/resultado`):

```ts
const DIAS_PADRAO = 30

/**
 * Traduz os parametros da URL em janela de coorte. Puro, com o relogio
 * injetado, porque a tela precisa dele testado sem subir servidor — e porque
 * `new Date('ontem')` devolve Invalid Date sem lancar, e uma janela invalida
 * chegaria no banco como null.
 */
export function interpretarPeriodo(
  params: { dias?: string; de?: string; ate?: string },
  agora: Date,
): Resultado<{ de: Date; ate: Date }> {
  if (params.de || params.ate) {
    const de = new Date(params.de ?? '')
    const ate = new Date(params.ate ?? '')
    if (Number.isNaN(de.getTime()) || Number.isNaN(ate.getTime())) return falha('periodo_invalido')
    // Janela semiaberta: de === ate nao pegaria lead nenhum, e a tela ficaria
    // vazia sem dizer por que.
    if (de >= ate) return falha('periodo_invalido')
    return ok({ de, ate })
  }

  const dias = Number(params.dias)
  const efetivos = Number.isFinite(dias) && dias > 0 ? dias : DIAS_PADRAO
  return ok({ de: new Date(agora.getTime() - efetivos * 86_400_000), ate: agora })
}
```

- [ ] **Step 4: Escrever a tela**

`src/app/(app)/metricas/page.tsx` — server component. Segue o padrão de `src/app/(app)/funil/page.tsx`: `searchParams` como `Promise`, `criarStoreDoServidor()`, `redirect('/login')` quando falha.

```tsx
import { redirect } from 'next/navigation'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import {
  canaisDaCoorte, etiquetasPorEtapa, funilDaCoorte, interpretarPeriodo,
} from '@/lib/domain/metricas'
import { Canais } from './canais'
import { Etiquetas } from './etiquetas'
import { Funil } from './funil'
import { Filtros } from './filtros'

const MENSAGENS: Record<string, string> = {
  periodo_invalido: 'O período escolhido é inválido: a data inicial tem que vir antes da final.',
  pipeline_invalido: 'Esse funil não existe nesta conta.',
}

/** Mensagem crua do PostgREST nao chega na tela: o backlog aponta ~30 sitios
 * com esse vazamento, e esta tela nasce certa. */
function mensagem(erro: string): string {
  return MENSAGENS[erro] ?? 'Não foi possível carregar as métricas agora. Tente de novo.'
}

export default async function MetricasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const params = await searchParams
  const contexto = await criarStoreDoServidor()
  if (!contexto.ok) redirect('/login')
  const { store, papel } = contexto.valor

  const periodo = interpretarPeriodo(params, new Date())
  if (!periodo.ok) {
    return <p className="p-6 text-destructive">{mensagem(periodo.erro)}</p>
  }

  const pipeline = await store.pipelinePadrao()
  if (!pipeline.ok) return <p className="p-6 text-destructive">{mensagem(pipeline.erro)}</p>
  const { etapas } = pipeline.valor

  const membros = await store.membros()
  if (!membros.ok) return <p className="p-6 text-destructive">{mensagem(membros.erro)}</p>

  const filtro = {
    pipelineId: pipeline.valor.pipeline.id,
    de: periodo.valor.de,
    ate: periodo.valor.ate,
    // Vendedor nunca escolhe: a RLS ja o recorta, e oferecer o seletor daria
    // a impressao de que ele poderia ver outra pessoa.
    responsavelId: papel === 'vendedor' ? null : (params.responsavel ?? null),
  }

  const [coorte, aplicacoes] = await Promise.all([
    store.metricasDaCoorte(filtro),
    store.etiquetasDaCoorte(filtro),
  ])
  if (!coorte.ok) return <p className="p-6 text-destructive">{mensagem(coorte.erro)}</p>
  if (!aplicacoes.ok) return <p className="p-6 text-destructive">{mensagem(aplicacoes.erro)}</p>

  const funil = funilDaCoorte(coorte.valor, etapas)
  const etapaEscolhida = etapas.find((e) => e.id === params.etapa) ?? etapas[0]!
  const ranking = etiquetasPorEtapa(coorte.valor, aplicacoes.valor, etapaEscolhida)
  const canais = canaisDaCoorte(coorte.valor)

  return (
    <div className="flex flex-col gap-6 p-6">
      <Filtros
        membros={membros.valor}
        podeFiltrarPorResponsavel={papel !== 'vendedor'}
      />
      {funil.totalDaCoorte === 0 ? (
        <p className="surface rounded-lg p-6 text-muted-foreground">
          Nenhum lead entrou nesse período. Conecte uma fonte em Configuração ou
          cadastre um lead no funil — as métricas aparecem no mesmo instante.
        </p>
      ) : (
        <>
          <Funil funil={funil} />
          <Etiquetas ranking={ranking} etapas={etapas} escolhida={etapaEscolhida} />
          <Canais raizes={canais} />
        </>
      )}
    </div>
  )
}
```

`funil.tsx` — barras como `div` com largura percentual, `--chart-1` na cor. Sem biblioteca de gráfico.

```tsx
import type { Funil as DadosFunil } from '@/lib/domain/metricas'

export function Funil({ funil }: { funil: DadosFunil }) {
  const maior = funil.degraus[0]?.alcancaram ?? 0
  return (
    <section className="surface rounded-lg p-6">
      <p className="eyebrow">Funil da coorte</p>
      <p className="mb-4 text-sm text-muted-foreground">
        <span className="tabular">{funil.totalDaCoorte}</span> leads criados no período.
        Lead recente ainda está descendo o funil — o período corrente sempre parece
        pior que um já fechado.
      </p>
      <ul className="flex flex-col gap-2">
        {funil.degraus.map((d) => (
          <li key={d.etapaId} className="flex items-center gap-3">
            <span className="w-40 shrink-0 text-sm">{d.nome}</span>
            <div className="h-6 flex-1 rounded bg-muted">
              <div
                className="h-6 rounded"
                style={{
                  width: `${maior === 0 ? 0 : (d.alcancaram / maior) * 100}%`,
                  background: 'var(--chart-1)',
                }}
              />
            </div>
            <span className="tabular w-12 text-right text-sm">{d.alcancaram}</span>
            <span className="tabular w-16 text-right text-sm text-muted-foreground">
              {Math.round(d.percentualDoAnterior)}%
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-4 grid grid-cols-3 gap-3">
        {[
          { rotulo: 'Ganhos', valor: funil.ganhos },
          { rotulo: 'Perdidos', valor: funil.perdidos },
          { rotulo: 'Ainda abertos', valor: funil.abertos },
        ].map((c) => (
          <div key={c.rotulo} className="surface rounded-lg p-4">
            <p className="eyebrow">{c.rotulo}</p>
            <p className="tabular text-2xl">{c.valor}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
```

**Os dois componentes abaixo vêm especificados por invariantes, não por código verbatim — e isso é deliberado.** O review final do Plano 3 concluiu que blocos grandes de código dentro do plano são a principal fonte de defeito deste projeto, porque nenhum compilador os vê e o implementador os trata como normativos; a recomendação registrada foi manter código literal **só onde a forma exata é carga estrutural** (corpo de função `security definer`, ordem de deleção, comparador anti-CSRF) e transformar o resto em assinatura mais invariantes. Componente de apresentação não é carga estrutural: o TypeScript, o lint e o portão de estilo cobrem a forma, e as invariantes abaixo são o que o revisor confere.

`etiquetas.tsx` — server component.
- Recebe `{ ranking: RankingEtiquetas; etapas: Etapa[]; escolhida: Etapa }`.
- Seletor de etapa por **link com `searchParams`** (`?etapa=<id>`), não por estado de cliente: a tela continua server-rendered e o filtro sobrevive a recarregar e a compartilhar a URL. Oferece **todas** as etapas, inclusive Ganho e Perdido — a spec diz que a visão serve tanto para entender perda quanto ganho.
- O **denominador aparece no cabeçalho** ("51 leads chegaram em Fechamento"). Sem ele o percentual fica solto e não se sabe sobre o quê.
- Diz, em texto, que a soma passa de 100% porque um lead carrega várias etiquetas.
- Barra proporcional ao `percentual`, mesma técnica de `funil.tsx` (`div` com largura em `%`), sem biblioteca.
- Ranking vazio mostra "Nenhuma etiqueta foi aplicada nesta etapa", nunca uma lista em branco.

`canais.tsx` — `'use client'`.
- Recebe `{ raizes: NoCanal[] }`.
- `useState<Set<string>>` com as chaves expandidas. A chave de expansão tem que ser **o caminho completo** (`meta/c1`), não `chave` sozinha: dois canais podem ter uma campanha com o mesmo `(sem campanha)` e expandir um abriria o outro.
- Colunas: rótulo, leads, ganhos, taxa, abertos. Todas as numéricas com `.tabular`.
- Quando `ehId` for `true`, um `<span className="eyebrow">id</span>` ao lado do rótulo — o número nunca pode se passar por nome.
- Nível de origem traduz a chave (`meta` → "Meta Ads", `google` → "Google Ads", `manual` → "Manual", `indicacao` → "Indicação", `organico` → "Orgânico") por um mapa local. O domínio emite o valor cru de propósito, para não carregar texto de UI.
- Linha sem filhos não renderiza controle de expansão.

`filtros.tsx` — `'use client'`, mesmo padrão de `src/app/(app)/funil/filtros.tsx`: escreve em `searchParams`.
- Período: 7 / 30 / 90 dias, mais um par de campos de data para intervalo customizado. Os nomes dos parâmetros são `dias`, `de` e `ate`, exatamente os que `interpretarPeriodo` lê.
- Responsável: só renderizado quando `podeFiltrarPorResponsavel` é `true`.
- **Sem seletor de pipeline.** A spec o lista, mas `criar_conta` cria um pipeline por conta e multi-pipeline é fase 2 na `v.0` — o seletor seria uma lista de um item, o mesmo motivo pelo qual o filtro de responsável some para o vendedor. A página já usa `pipelinePadrao()`, e o argumento `p_pipeline_id` da RPC existe para o dia em que houver mais de um. Se este plano for executado depois de multi-pipeline existir, o seletor entra aqui.

`layout.tsx` — acrescente o link entre "Funil" e "Configuração", visível para os três papéis:

```tsx
          <a href="/metricas" className="text-sm underline">
            Métricas
          </a>
```

- [ ] **Step 5: Rodar tudo**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: verde. O `npm test` inclui `src/lib/ui/estilo.test.ts`, que **falha se alguma classe de paleta crua tiver entrado nas telas novas** — é o portão que impede a aba de nascer fora do sistema de design.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)/metricas src/app/\(app\)/layout.tsx src/lib/domain/metricas.ts src/lib/domain/metricas.test.ts
git commit -m "feat: aba de metricas com funil, etiquetas e canais"
```

---

### Task 6: E2E

**Files:**
- Create: `tests/e2e/metricas.spec.ts`

**Interfaces:**
- Consumes: a tela da Task 5.

- [ ] **Step 1: Escrever o spec**

Siga o padrão dos specs existentes (`tests/e2e/sino.spec.ts`, `ingestao.spec.ts`): signup, e as helpers de `tests/e2e/`.

Cobrir, num spec só:

1. Um lead **manual** criado pela UI e arrastado até uma etapa do meio, mais um lead do **webhook** (com a árvore de anúncio completa, que o `MetaGraphFalso` já devolve).
2. Abrir `/metricas` e ver o funil decrescendo, com o número do degrau batendo com os leads criados.
3. Expandir o canal Meta até o **anúncio** — é a pergunta que fez o sub-projeto existir.
4. Ver que o lead manual aparece sob `(sem campanha)`. **Isto cobre o caso que o duplo do Graph não alcança**: lead manual não tem rastreamento nenhum, então não é preciso ensinar o `MetaGraphFalso` a devolver árvore parcial.
5. Trocar o filtro para `?dias=7` e ver o número mudar.

**Sobre asserção negativa:** se algum caso afirmar que algo *não* aparece, uma asserção positiva que só vale no estado pós-mudança tem que ter passado antes sobre a mesma subárvore. `toHaveCount(0)` resolve no instante em que observa o estado passando e para de olhar — já correu na frente do próprio bug neste repo.

- [ ] **Step 2: Rodar**

Run: `npm run test:e2e` (com `npm run dev` derrubado e `npx supabase start` de pé)
Expected: verde.

- [ ] **Step 3: Provar que o E2E discrimina**

Quebre `funilDaCoorte` de propósito — troque `l.ordemMax >= etapa.ordem` por `>` — e rode o spec. Ele tem que ficar **vermelho**. Restaure e confirme verde.

Ler o teste e concluir que ele discrimina não substitui rodar: no Plano 3, duas asserções foram julgadas discriminantes por dois leitores independentes e não eram. Registre a saída dos dois runs.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/metricas.spec.ts
git commit -m "test: E2E da aba de metricas, do lead ao anuncio"
```

---

## Verificação final da branch

- [ ] `npx supabase db reset` e depois `npm test && npm run test:integration && npm run test:e2e && npm run typecheck && npm run lint && npm run build` — **rodados no resultado do merge, não só antes dele.**
- [ ] Abrir a aba com o olho: conta nova (estado vazio), conta com leads, e um vendedor (que tem que ver só a coorte dele e nenhum seletor de responsável). O portão de estilo prova completude, não legibilidade — e neste projeto o olho já achou duas vezes o que suíte nenhuma achou.

## Decisões herdadas que este plano deliberadamente aceita

Vieram do review final do Plano 5 e ficam registradas para não parecerem esquecimento:

- **Anúncio órfão de campanha aparece em dois galhos.** Quando `arvoreDoAnuncio` falha, o lead fica com `anuncio_id` e `campanha_id` nulo, então o mesmo anúncio surge sob a campanha e sob `(sem campanha)`. Não há caminho de reparo: a entrega já está `processado` e o cron não repete. Aceito — a alternativa era a ambiguidade que o Plano 5 removeu. O `(sem campanha)` explícito é o que torna isso visível em vez de silencioso.
- **O dedup não atualiza `origem` nem o rastreamento.** Reincidência do Meta sobre um lead manual continua contando como `origem = 'manual'`. É atribuição de primeiro toque, e fica assim de propósito.
- **`MetaGraphFalso` não devolve nível nulo**, e este plano não o ensina a devolver: o caso `(sem campanha)` é coberto no domínio por teste unitário e no E2E por um lead manual, que não tem rastreamento nenhum. Ensinar o duplo seria construir o que não é preciso.
