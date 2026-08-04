# CRM — Plano 2: Funil (Kanban, leads, etiquetas, ficha, configuração)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar as telas que tornam o CRM utilizável — Kanban com drag-and-drop, cadastro de lead com aviso de duplicata, etiquetas no momento da qualificação, ficha com timeline e configuração de etapas, motivos e usuários.

**Architecture:** Server Components leem pelo `CrmStore` resolvido no servidor; mutações são Server Actions que retornam `Resultado<T>`. A única exceção é a troca de etapa, que passa pelo RPC `move_lead_stage`. Um segundo port `AdminStore` isola as operações de configuração, que só o admin executa.

**Tech Stack:** Next.js 15, TypeScript, Tailwind, `@dnd-kit/core`, Supabase, Vitest, Playwright.

**Pré-requisito:** Plano 1 concluído (`docs/superpowers/plans/2026-07-27-plano-1-fundacao.md`). O `CrmStore`, o `SupabaseCrmStore`, as migrations `0001`–`0004` e o fluxo de auth já existem.

**Spec:** `docs/superpowers/specs/2026-07-27-crm-fundacao-funil-design.md`

## Global Constraints

- Herda todas as constraints globais do Plano 1 (sem `service_role`, RLS em toda tabela, `search_path` em toda função, dinheiro em centavos, insert-only em `stage_history` e `lead_events`).
- Nenhum componente cliente importa `@supabase/*`. Dados chegam por props de Server Component; mutações por Server Action.
- Toda Server Action devolve `Resultado<T>`; nenhuma exception vaza para a UI.
- Toda leitura que devolve zero linhas por RLS é tratada como "não encontrado", nunca como erro de permissão.
- Drag-and-drop é otimista: o card move na hora e volta em caso de falha.
- Mobile está fora de escopo. A tela deve ser navegável em telas pequenas, mas o Kanban é otimizado para desktop.

---

### Task 1: Kanban de leitura

**Files:**
- Create: `src/app/(app)/funil/page.tsx` (substitui o placeholder do Plano 1)
- Create: `src/app/(app)/funil/quadro.tsx`
- Create: `src/app/(app)/funil/cartao.tsx`
- Create: `src/app/(app)/funil/filtros.tsx`
- Create: `src/lib/domain/formato.ts`
- Test: `src/lib/domain/formato.test.ts`

**Interfaces:**
- Consumes: `criarStoreDoServidor()` de `@/lib/data/supabase`; `Lead`, `Etapa`, `Membro` de `@/lib/domain/tipos`; `horasNaEtapa`, `rotuloTempoNaEtapa` de `@/lib/domain/lead`.
- Produces:
  - `formato.ts`: `formatarMoeda(centavos: number | null): string`, `formatarTelefone(e164: string | null): string`.
  - `<Quadro etapas={} leads={} membros={} podeFiltrarPorResponsavel={} />` — componente cliente que recebe tudo por props. A Task 2 acrescenta o drag-and-drop nele.

- [ ] **Step 1: Escrever os testes de formatação**

Create `src/lib/domain/formato.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatarMoeda, formatarTelefone } from './formato'

describe('formatarMoeda', () => {
  it('formata centavos em reais', () => {
    expect(formatarMoeda(150000)).toBe('R$ 1.500,00')
    expect(formatarMoeda(0)).toBe('R$ 0,00')
  })

  it('devolve traco para valor ausente', () => {
    expect(formatarMoeda(null)).toBe('—')
  })
})

describe('formatarTelefone', () => {
  it('formata celular brasileiro', () => {
    expect(formatarTelefone('+5583999991234')).toBe('(83) 99999-1234')
  })

  it('formata fixo brasileiro', () => {
    expect(formatarTelefone('+558332221234')).toBe('(83) 3222-1234')
  })

  it('devolve o proprio numero quando nao e brasileiro', () => {
    expect(formatarTelefone('+14155550100')).toBe('+14155550100')
  })

  it('devolve traco para ausente', () => {
    expect(formatarTelefone(null)).toBe('—')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./formato"`.

- [ ] **Step 3: Implementar as formatações**

Create `src/lib/domain/formato.ts`:

```ts
const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export function formatarMoeda(centavos: number | null): string {
  if (centavos === null || centavos === undefined) return '—'
  return MOEDA.format(centavos / 100).replace(/ /g, ' ')
}

export function formatarTelefone(e164: string | null): string {
  if (!e164) return '—'
  if (!e164.startsWith('+55')) return e164
  const d = e164.slice(3)
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return e164
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: PASS — 39 testes.

- [ ] **Step 5: Escrever o cartão do lead**

Create `src/app/(app)/funil/cartao.tsx`:

```tsx
'use client'

import Link from 'next/link'
import type { Lead } from '@/lib/domain/tipos'
import { horasNaEtapa, rotuloTempoNaEtapa } from '@/lib/domain/lead'
import { formatarMoeda } from '@/lib/domain/formato'

export function Cartao({ lead, nomeResponsavel }: { lead: Lead; nomeResponsavel: string | null }) {
  const horas = horasNaEtapa(lead.entrouNaEtapaEm, new Date())
  // O contador de tempo parado e o que provoca acao; destacamos a partir de 3 dias.
  const parado = horas >= 72

  return (
    <article className="rounded border bg-white p-3 shadow-sm">
      <Link href={`/leads/${lead.id}`} className="font-medium hover:underline">
        {lead.nome}
      </Link>
      <p className="mt-1 text-sm text-neutral-600">{formatarMoeda(lead.valorCents)}</p>
      {lead.etiquetas.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1">
          {lead.etiquetas.map((e) => (
            <li key={e.id} className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs">
              {e.nome}
            </li>
          ))}
        </ul>
      )}
      <footer className="mt-2 flex items-center justify-between text-xs text-neutral-500">
        <span>{nomeResponsavel ?? 'sem responsável'}</span>
        <span className={parado ? 'font-medium text-red-600' : undefined}>
          {rotuloTempoNaEtapa(horas)}
        </span>
      </footer>
    </article>
  )
}
```

- [ ] **Step 6: Escrever os filtros**

Create `src/app/(app)/funil/filtros.tsx`:

```tsx
'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import type { Membro } from '@/lib/domain/tipos'

const PERIODOS = [
  { valor: '', rotulo: 'Todo o período' },
  { valor: '7', rotulo: 'Últimos 7 dias' },
  { valor: '30', rotulo: 'Últimos 30 dias' },
  { valor: '90', rotulo: 'Últimos 90 dias' },
]

const ORIGENS = [
  { valor: '', rotulo: 'Todas as origens' },
  { valor: 'manual', rotulo: 'Manual' },
  { valor: 'meta', rotulo: 'Meta Ads' },
  { valor: 'google', rotulo: 'Google Ads' },
  { valor: 'indicacao', rotulo: 'Indicação' },
  { valor: 'organico', rotulo: 'Orgânico' },
]

export function Filtros({
  membros,
  podeFiltrarPorResponsavel,
}: {
  membros: Membro[]
  podeFiltrarPorResponsavel: boolean
}) {
  const router = useRouter()
  const params = useSearchParams()

  function atualizar(chave: string, valor: string) {
    const novos = new URLSearchParams(params.toString())
    if (valor) novos.set(chave, valor)
    else novos.delete(chave)
    router.push(`/funil?${novos.toString()}`)
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-6 py-3">
      <input
        defaultValue={params.get('busca') ?? ''}
        placeholder="buscar por nome, telefone ou email"
        className="rounded border px-2 py-1 text-sm"
        onKeyDown={(e) => {
          if (e.key === 'Enter') atualizar('busca', (e.target as HTMLInputElement).value)
        }}
      />
      {podeFiltrarPorResponsavel && (
        <select
          defaultValue={params.get('responsavel') ?? ''}
          className="rounded border px-2 py-1 text-sm"
          onChange={(e) => atualizar('responsavel', e.target.value)}
        >
          <option value="">Todos os responsáveis</option>
          {membros.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nome}
            </option>
          ))}
        </select>
      )}
      <select
        defaultValue={params.get('origem') ?? ''}
        className="rounded border px-2 py-1 text-sm"
        onChange={(e) => atualizar('origem', e.target.value)}
      >
        {ORIGENS.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
      </select>
      <select
        defaultValue={params.get('dias') ?? ''}
        className="rounded border px-2 py-1 text-sm"
        onChange={(e) => atualizar('dias', e.target.value)}
      >
        {PERIODOS.map((p) => (
          <option key={p.valor} value={p.valor}>
            {p.rotulo}
          </option>
        ))}
      </select>
    </div>
  )
}
```

- [ ] **Step 7: Escrever o quadro (ainda sem drag-and-drop)**

Create `src/app/(app)/funil/quadro.tsx`:

```tsx
'use client'

import type { Etapa, Lead, Membro } from '@/lib/domain/tipos'
import { Cartao } from './cartao'

export function Quadro({
  etapas,
  leads,
  membros,
}: {
  etapas: Etapa[]
  leads: Lead[]
  membros: Membro[]
}) {
  const nomePorId = new Map(membros.map((m) => [m.id, m.nome]))

  return (
    <div className="flex gap-4 overflow-x-auto p-6">
      {etapas.map((etapa) => {
        const daEtapa = leads.filter((l) => l.stageId === etapa.id)
        return (
          <section key={etapa.id} className="flex w-72 shrink-0 flex-col gap-2">
            <header className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">{etapa.nome}</h2>
              <span className="text-xs text-neutral-500">{daEtapa.length}</span>
            </header>
            <div className="flex min-h-24 flex-col gap-2 rounded bg-neutral-50 p-2">
              {daEtapa.map((lead) => (
                <Cartao
                  key={lead.id}
                  lead={lead}
                  nomeResponsavel={lead.responsavelId ? nomePorId.get(lead.responsavelId) ?? null : null}
                />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 8: Escrever a página do funil**

Create `src/app/(app)/funil/page.tsx` (substituindo o placeholder):

```tsx
import { redirect } from 'next/navigation'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import type { Lead } from '@/lib/domain/tipos'
import { Filtros } from './filtros'
import { Quadro } from './quadro'

export default async function FunilPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const params = await searchParams
  const contexto = await criarStoreDoServidor()
  if (!contexto.ok) redirect('/login')
  const { store, papel } = contexto.valor

  const pipeline = await store.pipelinePadrao()
  if (!pipeline.ok) throw new Error(pipeline.erro)

  const dias = params.dias ? Number(params.dias) : null
  const leads = await store.listarLeads({
    responsavelId: params.responsavel ?? null,
    origem: (params.origem as Lead['origem']) || null,
    desde: dias ? new Date(Date.now() - dias * 86_400_000) : null,
    busca: params.busca ?? null,
  })
  if (!leads.ok) throw new Error(leads.erro)

  const membros = await store.membros()
  if (!membros.ok) throw new Error(membros.erro)

  return (
    <>
      <Filtros membros={membros.valor} podeFiltrarPorResponsavel={papel !== 'vendedor'} />
      <Quadro etapas={pipeline.valor.etapas} leads={leads.valor} membros={membros.valor} />
    </>
  )
}
```

- [ ] **Step 9: Verificar no navegador**

```bash
npm run dev
```

Entrar com a conta criada no Plano 1 e abrir `/funil`. Esperado: 7 colunas na ordem `Novo lead, Contato feito, Qualificação, Proposta, Fechamento, Ganho, Perdido`, todas vazias com contador `0`.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: kanban de leitura com filtros e tempo parado na etapa"
```

---

### Task 2: Cadastro rápido de lead com aviso de duplicata

**Files:**
- Create: `src/app/(app)/funil/acoes.ts`
- Create: `src/app/(app)/funil/novo-lead.tsx`
- Modify: `src/app/(app)/funil/page.tsx` (renderizar o botão)
- Test: `tests/integration/duplicados.test.ts`

**Interfaces:**
- Consumes: `criarStoreDoServidor`, `leadSchema`, `possiveisDuplicados`, `criarLead`.
- Produces: Server Actions `verificarDuplicados(telefone, email)` → `Resultado<{ id: string; nome: string; status: string }[]>` e `criarLeadAction(formData)` → `Resultado<string>`.

- [ ] **Step 1: Escrever o teste de integração de duplicados**

Create `tests/integration/duplicados.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { comoServico, limparBanco } from './helpers/db'
import { montarCenario, etapa, type Cenario } from './helpers/cenario'

describe('possiveis duplicados', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  it('o indice de telefone nao e unico: a mesma pessoa pode virar lead de novo', async () => {
    const novo = etapa(c, 'Novo lead')
    const inserir = () =>
      comoServico((cli) =>
        cli.query(
          `insert into public.leads (account_id, nome, telefone_e164, pipeline_id, stage_id)
           values ($1, 'Ana', '+5583999991234', $2, $3)`,
          [c.accountId, c.pipelineId, novo],
        ),
      )

    await inserir()
    await expect(inserir()).resolves.toBeDefined()

    const n = await comoServico(async (cli) =>
      (
        await cli.query(
          `select count(*)::int as n from public.leads where telefone_e164 = '+5583999991234'`,
        )
      ).rows[0].n,
    )
    expect(n).toBe(2)
  })
})
```

- [ ] **Step 2: Rodar e ver passar**

Run: `npm run test:integration -- tests/integration/duplicados.test.ts`
Expected: PASS — 1 teste. (O comportamento já vem da migration `0003`; este teste trava a decisão para que ninguém adicione um índice único depois.)

- [ ] **Step 3: Escrever as Server Actions do funil**

Create `src/app/(app)/funil/acoes.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import { leadSchema } from '@/lib/domain/lead'
import { normalizarEmail, normalizarTelefone } from '@/lib/domain/normalizacao'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'

export type Duplicado = { id: string; nome: string; status: string }

export async function verificarDuplicados(
  telefone: string,
  email: string,
): Promise<Resultado<Duplicado[]>> {
  const contexto = await criarStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)

  const r = await contexto.valor.store.possiveisDuplicados(
    normalizarTelefone(telefone),
    normalizarEmail(email),
  )
  if (!r.ok) return falha(r.erro)
  return ok(r.valor.map((l) => ({ id: l.id, nome: l.nome, status: l.status })))
}

export async function criarLeadAction(formData: FormData): Promise<Resultado<string>> {
  const contexto = await criarStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)
  const { store, usuarioId, papel } = contexto.valor

  const valorTexto = String(formData.get('valor') ?? '').trim()
  const parsed = leadSchema.safeParse({
    nome: formData.get('nome'),
    telefone: formData.get('telefone'),
    email: formData.get('email'),
    empresa: formData.get('empresa'),
    valorCents: valorTexto ? Math.round(Number(valorTexto.replace(',', '.')) * 100) : null,
    // Vendedor so cria lead para si; gestor e admin escolhem o responsavel.
    responsavelId:
      papel === 'vendedor' ? usuarioId : (formData.get('responsavelId') as string) || null,
  })
  if (!parsed.success) return falha(parsed.error.issues[0].message)

  const pipeline = await store.pipelinePadrao()
  if (!pipeline.ok) return falha(pipeline.erro)
  const primeira = pipeline.valor.etapas.find((e) => e.tipo === 'aberta')
  if (!primeira) return falha('pipeline_sem_etapa_aberta')

  const r = await store.criarLead({
    ...parsed.data,
    pipelineId: pipeline.valor.pipeline.id,
    stageId: primeira.id,
  })
  if (!r.ok) return falha(r.erro)

  revalidatePath('/funil')
  return ok(r.valor)
}
```

- [ ] **Step 4: Escrever o modal de novo lead**

Create `src/app/(app)/funil/novo-lead.tsx`:

```tsx
'use client'

import { useState } from 'react'
import type { Membro } from '@/lib/domain/tipos'
import { criarLeadAction, verificarDuplicados, type Duplicado } from './acoes'

const MENSAGENS: Record<string, string> = {
  nome_obrigatorio: 'Informe o nome do lead.',
  pipeline_sem_etapa_aberta: 'Configure ao menos uma etapa aberta antes de cadastrar leads.',
}

export function NovoLead({
  membros,
  podeEscolherResponsavel,
}: {
  membros: Membro[]
  podeEscolherResponsavel: boolean
}) {
  const [aberto, setAberto] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [duplicados, setDuplicados] = useState<Duplicado[]>([])

  async function checar(telefone: string, email: string) {
    if (!telefone && !email) return
    const r = await verificarDuplicados(telefone, email)
    setDuplicados(r.ok ? r.valor : [])
  }

  async function salvar(formData: FormData) {
    const r = await criarLeadAction(formData)
    if (!r.ok) {
      setErro(MENSAGENS[r.erro] ?? r.erro)
      return
    }
    setErro(null)
    setDuplicados([])
    setAberto(false)
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="rounded bg-black px-3 py-1 text-sm text-white"
      >
        Novo lead
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded bg-white p-5">
        <h2 className="mb-3 text-lg font-semibold">Novo lead</h2>
        <form action={salvar} className="flex flex-col gap-2">
          <input name="nome" placeholder="nome" required className="rounded border p-2" />
          <input
            name="telefone"
            placeholder="telefone"
            className="rounded border p-2"
            onBlur={(e) =>
              checar(e.target.value, (e.currentTarget.form?.email as HTMLInputElement)?.value ?? '')
            }
          />
          <input
            name="email"
            placeholder="email"
            className="rounded border p-2"
            onBlur={(e) =>
              checar(
                (e.currentTarget.form?.telefone as HTMLInputElement)?.value ?? '',
                e.target.value,
              )
            }
          />
          <input name="empresa" placeholder="empresa" className="rounded border p-2" />
          <input name="valor" placeholder="valor em reais" className="rounded border p-2" />
          {podeEscolherResponsavel && (
            <select name="responsavelId" defaultValue="" className="rounded border p-2">
              <option value="">sem responsável</option>
              {membros.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                </option>
              ))}
            </select>
          )}

          {duplicados.length > 0 && (
            <div className="rounded border border-amber-300 bg-amber-50 p-2 text-sm">
              <p className="font-medium">Já existe lead com esse contato:</p>
              <ul className="mt-1 list-disc pl-4">
                {duplicados.map((d) => (
                  <li key={d.id}>
                    <a href={`/leads/${d.id}`} className="underline">
                      {d.nome}
                    </a>{' '}
                    <span className="text-neutral-600">({d.status})</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-neutral-600">
                Você pode continuar mesmo assim — recompra vira lead novo.
              </p>
            </div>
          )}

          {erro && <p className="text-sm text-red-600">{erro}</p>}

          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setAberto(false)} className="px-3 py-1 text-sm">
              Cancelar
            </button>
            <button type="submit" className="rounded bg-black px-3 py-1 text-sm text-white">
              Salvar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Encaixar o botão na página**

Modify `src/app/(app)/funil/page.tsx` — trocar o `return` final por:

```tsx
  return (
    <>
      <div className="flex items-center justify-between border-b px-6 py-3">
        <Filtros membros={membros.valor} podeFiltrarPorResponsavel={papel !== 'vendedor'} />
        <NovoLead membros={membros.valor} podeEscolherResponsavel={papel !== 'vendedor'} />
      </div>
      <Quadro etapas={pipeline.valor.etapas} leads={leads.valor} membros={membros.valor} />
    </>
  )
```

E adicionar o import no topo:

```tsx
import { NovoLead } from './novo-lead'
```

Remover a borda duplicada: em `filtros.tsx`, trocar a className do `<div>` raiz de `"flex flex-wrap items-center gap-2 border-b px-6 py-3"` para `"flex flex-wrap items-center gap-2"`.

- [ ] **Step 6: Verificar no navegador**

```bash
npm run dev
```

Em `/funil`, clicar "Novo lead", preencher nome "Ana" e telefone "(83) 99999-1234", salvar. Esperado: card "Ana" aparece na coluna "Novo lead". Abrir de novo, digitar o mesmo telefone e sair do campo. Esperado: aviso amarelo listando "Ana (aberto)" e permitindo salvar assim mesmo.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: cadastro rapido de lead com aviso de possivel duplicata"
```

---

### Task 3: Drag-and-drop com modal de etiquetas e motivo de perda

**Files:**
- Modify: `src/app/(app)/funil/quadro.tsx`
- Create: `src/app/(app)/funil/modal-movimento.tsx`
- Modify: `src/app/(app)/funil/acoes.ts` (acrescentar `moverEtapaAction`)
- Modify: `src/app/(app)/funil/page.tsx` (passar motivos e etiquetas ao quadro)

**Interfaces:**
- Consumes: `store.moverEtapa`, `store.aplicarEtiquetas`, `store.motivosPerda`, `store.etiquetasDaConta`.
- Produces: Server Action `moverEtapaAction(leadId, stageDestino, lossReasonId, etiquetas)` → `Resultado<void>`. Aplica as etiquetas **antes** de mover, para que o snapshot `stage_id_no_momento` grave a etapa de origem — que é a etapa em que a qualificação aconteceu.

- [ ] **Step 1: Instalar o dnd-kit**

```bash
npm install @dnd-kit/core
```

- [ ] **Step 2: Escrever a Server Action de movimento**

Modify `src/app/(app)/funil/acoes.ts` — acrescentar ao final:

```ts
export async function moverEtapaAction(
  leadId: string,
  stageDestino: string,
  lossReasonId: string | null,
  etiquetas: string[],
): Promise<Resultado<void>> {
  const contexto = await criarStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)
  const { store } = contexto.valor

  // Etiquetas primeiro: o snapshot precisa gravar a etapa de ORIGEM, que e onde
  // a qualificacao aconteceu. Depois de mover, o snapshot registraria o destino.
  if (etiquetas.length > 0) {
    const r = await store.aplicarEtiquetas(leadId, etiquetas)
    if (!r.ok) return falha(r.erro)
  }

  const r = await store.moverEtapa(leadId, stageDestino, lossReasonId)
  if (!r.ok) return falha(r.erro)

  revalidatePath('/funil')
  return ok(undefined)
}
```

- [ ] **Step 3: Escrever o modal de movimento**

Create `src/app/(app)/funil/modal-movimento.tsx`:

```tsx
'use client'

import { useState } from 'react'
import type { Etapa, Etiqueta, MotivoPerda } from '@/lib/domain/tipos'

export type PedidoMovimento = { leadId: string; nomeLead: string; destino: Etapa }

export function ModalMovimento({
  pedido,
  motivos,
  etiquetasConhecidas,
  onCancelar,
  onConfirmar,
}: {
  pedido: PedidoMovimento
  motivos: MotivoPerda[]
  etiquetasConhecidas: Etiqueta[]
  onCancelar: () => void
  onConfirmar: (lossReasonId: string | null, etiquetas: string[]) => void
}) {
  const exigeMotivo = pedido.destino.tipo === 'perdido'
  const [motivoId, setMotivoId] = useState('')
  const [entrada, setEntrada] = useState('')
  const [escolhidas, setEscolhidas] = useState<string[]>([])

  function adicionar(nome: string) {
    const limpo = nome.trim()
    if (!limpo) return
    if (escolhidas.some((e) => e.toLowerCase() === limpo.toLowerCase())) return
    setEscolhidas([...escolhidas, limpo])
    setEntrada('')
  }

  const sugestoes = etiquetasConhecidas
    .filter((e) => e.nome.toLowerCase().includes(entrada.toLowerCase()))
    .filter((e) => !escolhidas.some((x) => x.toLowerCase() === e.nome.toLowerCase()))
    .slice(0, 6)

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded bg-white p-5">
        <h2 className="text-lg font-semibold">
          {pedido.nomeLead} → {pedido.destino.nome}
        </h2>

        {exigeMotivo && (
          <label className="mt-3 block text-sm">
            Motivo da perda <span className="text-red-600">*</span>
            <select
              value={motivoId}
              onChange={(e) => setMotivoId(e.target.value)}
              className="mt-1 w-full rounded border p-2"
            >
              <option value="">selecione</option>
              {motivos.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="mt-3 text-sm">
          <span>Etiquetas {exigeMotivo ? '' : '(opcional)'}</span>
          <input
            value={entrada}
            onChange={(e) => setEntrada(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                adicionar(entrada)
              }
            }}
            placeholder="digite e pressione Enter"
            className="mt-1 w-full rounded border p-2"
          />
          {sugestoes.length > 0 && (
            <ul className="mt-1 flex flex-wrap gap-1">
              {sugestoes.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => adicionar(s.nome)}
                    className="rounded bg-neutral-100 px-2 py-0.5 text-xs hover:bg-neutral-200"
                  >
                    {s.nome}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {escolhidas.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1">
              {escolhidas.map((e) => (
                <li key={e} className="rounded bg-black px-2 py-0.5 text-xs text-white">
                  {e}
                  <button
                    type="button"
                    onClick={() => setEscolhidas(escolhidas.filter((x) => x !== e))}
                    className="ml-1"
                    aria-label={`remover ${e}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancelar} className="px-3 py-1 text-sm">
            Cancelar
          </button>
          <button
            type="button"
            disabled={exigeMotivo && !motivoId}
            onClick={() => onConfirmar(exigeMotivo ? motivoId : null, escolhidas)}
            className="rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-40"
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Reescrever o quadro com drag-and-drop otimista**

Replace `src/app/(app)/funil/quadro.tsx`:

```tsx
'use client'

import { useState } from 'react'
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import type { Etapa, Etiqueta, Lead, Membro, MotivoPerda } from '@/lib/domain/tipos'
import { Cartao } from './cartao'
import { ModalMovimento, type PedidoMovimento } from './modal-movimento'
import { moverEtapaAction } from './acoes'

const MENSAGENS: Record<string, string> = {
  motivo_perda_obrigatorio: 'Escolha o motivo da perda.',
  motivo_perda_invalido: 'Esse motivo de perda não pertence à sua conta.',
  etapa_invalida: 'Essa etapa não pertence ao seu funil.',
  lead_nao_encontrado: 'Você não tem acesso a esse lead.',
}

function CartaoArrastavel({ lead, nomeResponsavel }: { lead: Lead; nomeResponsavel: string | null }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lead.id })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={isDragging ? 'opacity-40' : undefined}
    >
      <Cartao lead={lead} nomeResponsavel={nomeResponsavel} />
    </div>
  )
}

function Coluna({ etapa, children, total }: { etapa: Etapa; children: React.ReactNode; total: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: etapa.id })
  return (
    <section className="flex w-72 shrink-0 flex-col gap-2">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{etapa.nome}</h2>
        <span className="text-xs text-neutral-500">{total}</span>
      </header>
      <div
        ref={setNodeRef}
        className={`flex min-h-24 flex-col gap-2 rounded p-2 ${
          isOver ? 'bg-neutral-200' : 'bg-neutral-50'
        }`}
      >
        {children}
      </div>
    </section>
  )
}

export function Quadro({
  etapas,
  leads,
  membros,
  motivos,
  etiquetasConhecidas,
}: {
  etapas: Etapa[]
  leads: Lead[]
  membros: Membro[]
  motivos: MotivoPerda[]
  etiquetasConhecidas: Etiqueta[]
}) {
  const [posicoes, setPosicoes] = useState<Lead[]>(leads)
  const [pedido, setPedido] = useState<PedidoMovimento | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const sensores = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const nomePorId = new Map(membros.map((m) => [m.id, m.nome]))

  function aoSoltar(evento: DragEndEvent) {
    const leadId = String(evento.active.id)
    const destinoId = evento.over ? String(evento.over.id) : null
    if (!destinoId) return

    const lead = posicoes.find((l) => l.id === leadId)
    const destino = etapas.find((e) => e.id === destinoId)
    if (!lead || !destino || lead.stageId === destino.id) return

    setPedido({ leadId, nomeLead: lead.nome, destino })
  }

  async function confirmar(lossReasonId: string | null, etiquetas: string[]) {
    if (!pedido) return
    const anterior = posicoes
    // Otimista: o card muda de coluna antes da resposta do servidor.
    setPosicoes(
      posicoes.map((l) => (l.id === pedido.leadId ? { ...l, stageId: pedido.destino.id } : l)),
    )
    setPedido(null)
    setErro(null)

    const r = await moverEtapaAction(pedido.leadId, pedido.destino.id, lossReasonId, etiquetas)
    if (!r.ok) {
      setPosicoes(anterior)
      setErro(MENSAGENS[r.erro] ?? r.erro)
    }
  }

  return (
    <>
      {erro && (
        <p className="mx-6 mt-3 rounded bg-red-50 p-2 text-sm text-red-700" role="alert">
          {erro}
        </p>
      )}
      <DndContext sensors={sensores} onDragEnd={aoSoltar}>
        <div className="flex gap-4 overflow-x-auto p-6">
          {etapas.map((etapa) => {
            const daEtapa = posicoes.filter((l) => l.stageId === etapa.id)
            return (
              <Coluna key={etapa.id} etapa={etapa} total={daEtapa.length}>
                {daEtapa.map((lead) => (
                  <CartaoArrastavel
                    key={lead.id}
                    lead={lead}
                    nomeResponsavel={
                      lead.responsavelId ? nomePorId.get(lead.responsavelId) ?? null : null
                    }
                  />
                ))}
              </Coluna>
            )
          })}
        </div>
      </DndContext>
      {pedido && (
        <ModalMovimento
          pedido={pedido}
          motivos={motivos}
          etiquetasConhecidas={etiquetasConhecidas}
          onCancelar={() => setPedido(null)}
          onConfirmar={confirmar}
        />
      )}
    </>
  )
}
```

- [ ] **Step 5: Passar motivos e etiquetas na página**

Modify `src/app/(app)/funil/page.tsx` — antes do `return`, acrescentar:

```tsx
  const motivos = await store.motivosPerda()
  if (!motivos.ok) throw new Error(motivos.erro)

  const etiquetas = await store.etiquetasDaConta()
  if (!etiquetas.ok) throw new Error(etiquetas.erro)
```

E trocar a linha do `<Quadro .../>` por:

```tsx
      <Quadro
        etapas={pipeline.valor.etapas}
        leads={leads.valor}
        membros={membros.valor}
        motivos={motivos.valor}
        etiquetasConhecidas={etiquetas.valor}
      />
```

- [ ] **Step 6: Verificar no navegador**

```bash
npm run dev
```

1. Arrastar "Ana" de "Novo lead" para "Qualificação". Modal abre pedindo etiquetas. Digitar "Preço alto" + Enter, confirmar. Card move.
2. Arrastar "Ana" para "Perdido". Modal exige motivo — o botão Confirmar fica desabilitado até escolher. Escolher "Preço", confirmar. Card move.
3. Conferir o snapshot da etiqueta:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select t.nome as etiqueta, s.nome as etapa_no_momento from public.lead_tags lt join public.tags t on t.id = lt.tag_id join public.stages s on s.id = lt.stage_id_no_momento"
```

Expected: `Preço alto | Novo lead` — a etapa de **origem**, onde a qualificação aconteceu, não o destino.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: drag-and-drop otimista com etiquetas e motivo de perda obrigatorio"
```

---

### Task 4: Ficha do lead com timeline

**Files:**
- Create: `src/app/(app)/leads/[id]/page.tsx`
- Create: `src/app/(app)/leads/[id]/timeline.tsx`
- Create: `src/app/(app)/leads/[id]/acoes.ts`
- Create: `src/app/(app)/leads/[id]/etiquetas.tsx`
- Create: `src/app/(app)/leads/[id]/nota.tsx`
- Create: `src/app/(app)/leads/[id]/acoes-lead.tsx`
- Modify: `src/lib/data/store.ts` (acrescentar `atribuirResponsavel`)
- Modify: `src/lib/data/memory.ts` e `src/lib/data/supabase.ts` (implementar)
- Test: `src/lib/data/memory.test.ts` (acrescentar caso)

**Interfaces:**
- Consumes: `store.buscarLead`, `store.eventosDoLead`, `store.registrarNota`, `store.aplicarEtiquetas`, `store.membros`, `store.pipelinePadrao`.
- Produces:
  - `CrmStore.atribuirResponsavel(leadId: string, responsavelId: string | null): Promise<Resultado<void>>` — implementado nas duas classes.
  - Server Actions `adicionarNota(leadId, texto)`, `adicionarEtiquetas(leadId, nomes)`, `trocarResponsavel(leadId, responsavelId)`, todas `Resultado<void>`.
  - `rotuloEvento(evento: EventoLead, nomes: Map<string, string>): string` em `timeline.tsx`.

- [ ] **Step 1: Escrever o teste do novo método no store in-memory**

Modify `src/lib/data/memory.test.ts` — acrescentar dentro do `describe`:

```ts
  it('atribui responsavel e registra evento', async () => {
    const p = await store.pipelinePadrao()
    if (!p.ok) throw new Error(p.erro)
    const criado = await store.criarLead({
      ...novoLead('Ana'),
      pipelineId: p.valor.pipeline.id,
      stageId: p.valor.etapas[0].id,
    })
    if (!criado.ok) throw new Error(criado.erro)

    const r = await store.atribuirResponsavel(criado.valor, 'user-2')
    expect(r.ok).toBe(true)

    const lead = await store.buscarLead(criado.valor)
    if (!lead.ok || !lead.valor) throw new Error('lead sumiu')
    expect(lead.valor.responsavelId).toBe('user-2')

    const eventos = await store.eventosDoLead(criado.valor)
    if (!eventos.ok) throw new Error(eventos.erro)
    expect(eventos.valor.map((e) => e.tipo)).toContain('responsavel_alterado')
  })

  it('registra nota na timeline', async () => {
    const p = await store.pipelinePadrao()
    if (!p.ok) throw new Error(p.erro)
    const criado = await store.criarLead({
      ...novoLead('Ana'),
      pipelineId: p.valor.pipeline.id,
      stageId: p.valor.etapas[0].id,
    })
    if (!criado.ok) throw new Error(criado.erro)

    await store.registrarNota(criado.valor, 'ligou, pediu proposta')

    const eventos = await store.eventosDoLead(criado.valor)
    if (!eventos.ok) throw new Error(eventos.erro)
    const nota = eventos.valor.find((e) => e.tipo === 'nota')
    expect(nota?.payload.texto).toBe('ligou, pediu proposta')
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `store.atribuirResponsavel is not a function`.

- [ ] **Step 3: Acrescentar o método ao port**

Modify `src/lib/data/store.ts` — dentro da interface `CrmStore`, após `moverEtapa`:

```ts
  atribuirResponsavel(leadId: string, responsavelId: string | null): Promise<Resultado<void>>
```

- [ ] **Step 4: Implementar no store in-memory**

Modify `src/lib/data/memory.ts` — acrescentar após `moverEtapa`:

```ts
  async atribuirResponsavel(
    leadId: string,
    responsavelId: string | null,
  ): Promise<Resultado<void>> {
    const lead = this.leads.find((l) => l.id === leadId)
    if (!lead) return falha('lead_nao_encontrado')
    const anterior = lead.responsavelId
    lead.responsavelId = responsavelId
    lead.atualizadoEm = new Date()
    this.eventos.push({
      id: randomUUID(),
      leadId,
      tipo: 'responsavel_alterado',
      payload: { de: anterior, para: responsavelId },
      atorId: this.usuarioAtual,
      criadoEm: new Date(),
    })
    return ok(undefined)
  }
```

- [ ] **Step 5: Implementar no store Supabase**

Modify `src/lib/data/supabase.ts` — acrescentar após `moverEtapa`:

```ts
  async atribuirResponsavel(
    leadId: string,
    responsavelId: string | null,
  ): Promise<Resultado<void>> {
    const atual = await this.buscarLead(leadId)
    if (!atual.ok) return falha(atual.erro)
    if (!atual.valor) return falha('lead_nao_encontrado')

    const { error } = await this.cliente
      .from('leads')
      .update({ responsavel_id: responsavelId, atualizado_em: new Date().toISOString() })
      .eq('id', leadId)
    if (error) return falha(error.message)

    await this.cliente.from('lead_events').insert({
      lead_id: leadId,
      tipo: 'responsavel_alterado',
      payload: { de: atual.valor.responsavelId, para: responsavelId },
      ator_id: this.usuarioId,
    })
    return ok(undefined)
  }
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npm test`
Expected: PASS — 41 testes.

- [ ] **Step 7: Escrever as Server Actions da ficha**

Create `src/app/(app)/leads/[id]/acoes.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'

export async function adicionarNota(leadId: string, texto: string): Promise<Resultado<void>> {
  const limpo = texto.trim()
  if (limpo.length === 0) return falha('nota_vazia')

  const contexto = await criarStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)

  const r = await contexto.valor.store.registrarNota(leadId, limpo)
  if (!r.ok) return falha(r.erro)

  revalidatePath(`/leads/${leadId}`)
  return ok(undefined)
}

export async function adicionarEtiquetas(
  leadId: string,
  nomes: string[],
): Promise<Resultado<void>> {
  const contexto = await criarStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)

  const r = await contexto.valor.store.aplicarEtiquetas(leadId, nomes)
  if (!r.ok) return falha(r.erro)

  revalidatePath(`/leads/${leadId}`)
  return ok(undefined)
}

export async function trocarResponsavel(
  leadId: string,
  responsavelId: string | null,
): Promise<Resultado<void>> {
  const contexto = await criarStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)
  if (contexto.valor.papel === 'vendedor') return falha('sem_permissao')

  const r = await contexto.valor.store.atribuirResponsavel(leadId, responsavelId)
  if (!r.ok) return falha(r.erro)

  revalidatePath(`/leads/${leadId}`)
  revalidatePath('/funil')
  return ok(undefined)
}
```

- [ ] **Step 8: Escrever a timeline**

Create `src/app/(app)/leads/[id]/timeline.tsx`:

```tsx
import type { EventoLead } from '@/lib/domain/tipos'

const FORMATO = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

export function rotuloEvento(
  evento: EventoLead,
  nomeEtapa: Map<string, string>,
  nomePessoa: Map<string, string>,
): string {
  const p = evento.payload
  switch (evento.tipo) {
    case 'lead_criado':
      return `Lead criado (origem: ${String(p.origem ?? 'manual')})`
    case 'etapa_alterada': {
      const de = p.de ? nomeEtapa.get(String(p.de)) ?? '?' : 'início'
      const para = nomeEtapa.get(String(p.para)) ?? '?'
      return `Etapa alterada: ${de} → ${para}`
    }
    case 'etiqueta_aplicada':
      return `Etiqueta "${String(p.tag)}" aplicada em ${nomeEtapa.get(String(p.etapa)) ?? '?'}`
    case 'responsavel_alterado': {
      const para = p.para ? nomePessoa.get(String(p.para)) ?? '?' : 'ninguém'
      return `Responsável alterado para ${para}`
    }
    case 'nota':
      return String(p.texto ?? '')
    default:
      return evento.tipo
  }
}

export function Timeline({
  eventos,
  nomeEtapa,
  nomePessoa,
}: {
  eventos: EventoLead[]
  nomeEtapa: Map<string, string>
  nomePessoa: Map<string, string>
}) {
  if (eventos.length === 0) {
    return <p className="text-sm text-neutral-500">Nada aconteceu ainda.</p>
  }

  return (
    <ol className="flex flex-col gap-3">
      {eventos.map((e) => (
        <li key={e.id} className="border-l-2 pl-3">
          <p className="text-sm">{rotuloEvento(e, nomeEtapa, nomePessoa)}</p>
          <p className="text-xs text-neutral-500">
            {FORMATO.format(e.criadoEm)}
            {e.atorId ? ` · ${nomePessoa.get(e.atorId) ?? ''}` : ''}
          </p>
        </li>
      ))}
    </ol>
  )
}
```

- [ ] **Step 9: Escrever o editor de etiquetas da ficha**

Create `src/app/(app)/leads/[id]/etiquetas.tsx`:

```tsx
'use client'

import { useState } from 'react'
import type { Etiqueta } from '@/lib/domain/tipos'
import { adicionarEtiquetas } from './acoes'

export function EditorEtiquetas({
  leadId,
  atuais,
  conhecidas,
}: {
  leadId: string
  atuais: Etiqueta[]
  conhecidas: Etiqueta[]
}) {
  const [entrada, setEntrada] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  const sugestoes = conhecidas
    .filter((c) => c.nome.toLowerCase().includes(entrada.toLowerCase()))
    .filter((c) => !atuais.some((a) => a.nome.toLowerCase() === c.nome.toLowerCase()))
    .slice(0, 6)

  async function aplicar(nome: string) {
    const limpo = nome.trim()
    if (!limpo) return
    const r = await adicionarEtiquetas(leadId, [limpo])
    if (!r.ok) setErro(r.erro)
    else {
      setErro(null)
      setEntrada('')
    }
  }

  return (
    <div>
      <ul className="flex flex-wrap gap-1">
        {atuais.map((e) => (
          <li key={e.id} className="rounded bg-neutral-100 px-2 py-0.5 text-xs">
            {e.nome}
          </li>
        ))}
      </ul>
      <input
        value={entrada}
        onChange={(e) => setEntrada(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            aplicar(entrada)
          }
        }}
        placeholder="nova etiqueta (Enter para aplicar)"
        className="mt-2 w-full rounded border p-2 text-sm"
      />
      {sugestoes.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-1">
          {sugestoes.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => aplicar(s.nome)}
                className="rounded bg-neutral-100 px-2 py-0.5 text-xs hover:bg-neutral-200"
              >
                {s.nome}
              </button>
            </li>
          ))}
        </ul>
      )}
      {erro && <p className="mt-1 text-sm text-red-600">{erro}</p>}
    </div>
  )
}
```

- [ ] **Step 10: Escrever as ações da ficha (mover etapa e trocar responsável)**

A spec pede as duas ações na ficha, não só no Kanban. A troca de etapa reusa o
`ModalMovimento` do funil, para que o motivo de perda continue obrigatório e a
etiqueta continue gravando a etapa de origem — regra única, um só componente.

Create `src/app/(app)/leads/[id]/acoes-lead.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Etapa, Etiqueta, Lead, Membro, MotivoPerda } from '@/lib/domain/tipos'
import { ModalMovimento, type PedidoMovimento } from '@/app/(app)/funil/modal-movimento'
import { moverEtapaAction } from '@/app/(app)/funil/acoes'
import { trocarResponsavel } from './acoes'

const MENSAGENS: Record<string, string> = {
  motivo_perda_obrigatorio: 'Escolha o motivo da perda.',
  motivo_perda_invalido: 'Esse motivo de perda não pertence à sua conta.',
  sem_permissao: 'Só gestor ou admin troca o responsável.',
}

export function AcoesLead({
  lead,
  etapas,
  membros,
  motivos,
  etiquetasConhecidas,
  podeTrocarResponsavel,
}: {
  lead: Lead
  etapas: Etapa[]
  membros: Membro[]
  motivos: MotivoPerda[]
  etiquetasConhecidas: Etiqueta[]
  podeTrocarResponsavel: boolean
}) {
  const router = useRouter()
  const [pedido, setPedido] = useState<PedidoMovimento | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  async function confirmar(lossReasonId: string | null, etiquetas: string[]) {
    if (!pedido) return
    const r = await moverEtapaAction(pedido.leadId, pedido.destino.id, lossReasonId, etiquetas)
    setPedido(null)
    if (!r.ok) setErro(MENSAGENS[r.erro] ?? r.erro)
    else {
      setErro(null)
      router.refresh()
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm">
        Mover para
        <select
          value={lead.stageId}
          onChange={(e) => {
            const destino = etapas.find((x) => x.id === e.target.value)
            if (destino && destino.id !== lead.stageId) {
              setPedido({ leadId: lead.id, nomeLead: lead.nome, destino })
            }
          }}
          className="mt-1 w-full rounded border p-2"
        >
          {etapas.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nome}
            </option>
          ))}
        </select>
      </label>

      {podeTrocarResponsavel && (
        <label className="text-sm">
          Responsável
          <select
            value={lead.responsavelId ?? ''}
            onChange={async (e) => {
              const r = await trocarResponsavel(lead.id, e.target.value || null)
              if (!r.ok) setErro(MENSAGENS[r.erro] ?? r.erro)
              else {
                setErro(null)
                router.refresh()
              }
            }}
            className="mt-1 w-full rounded border p-2"
          >
            <option value="">sem responsável</option>
            {membros.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome}
              </option>
            ))}
          </select>
        </label>
      )}

      {erro && <p className="text-sm text-red-600">{erro}</p>}

      {pedido && (
        <ModalMovimento
          pedido={pedido}
          motivos={motivos}
          etiquetasConhecidas={etiquetasConhecidas}
          onCancelar={() => setPedido(null)}
          onConfirmar={confirmar}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 11: Escrever a página da ficha**

Create `src/app/(app)/leads/[id]/page.tsx`:

```tsx
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import { formatarMoeda, formatarTelefone } from '@/lib/domain/formato'
import { Timeline } from './timeline'
import { EditorEtiquetas } from './etiquetas'
import { FormularioNota } from './nota'
import { AcoesLead } from './acoes-lead'

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const contexto = await criarStoreDoServidor()
  if (!contexto.ok) redirect('/login')
  const { store, papel } = contexto.valor

  const lead = await store.buscarLead(id)
  if (!lead.ok) throw new Error(lead.erro)
  // Zero linhas por RLS chega aqui como null: e "nao encontrado", nunca 403.
  if (!lead.valor) notFound()

  const [pipeline, membros, eventos, etiquetas, motivos] = await Promise.all([
    store.pipelinePadrao(),
    store.membros(),
    store.eventosDoLead(id),
    store.etiquetasDaConta(),
    store.motivosPerda(),
  ])
  if (!pipeline.ok) throw new Error(pipeline.erro)
  if (!membros.ok) throw new Error(membros.erro)
  if (!eventos.ok) throw new Error(eventos.erro)
  if (!etiquetas.ok) throw new Error(etiquetas.erro)
  if (!motivos.ok) throw new Error(motivos.erro)

  const nomeEtapa = new Map(pipeline.valor.etapas.map((e) => [e.id, e.nome]))
  const nomePessoa = new Map(membros.valor.map((m) => [m.id, m.nome]))

  return (
    <div className="mx-auto grid max-w-4xl gap-6 p-6 md:grid-cols-[1fr_1.2fr]">
      <section className="flex flex-col gap-3">
        <Link href="/funil" className="text-sm underline">
          ← voltar ao funil
        </Link>
        <h1 className="text-2xl font-semibold">{lead.valor.nome}</h1>
        <dl className="text-sm">
          <div className="flex justify-between border-b py-1">
            <dt className="text-neutral-500">Etapa</dt>
            <dd>{nomeEtapa.get(lead.valor.stageId) ?? '—'}</dd>
          </div>
          <div className="flex justify-between border-b py-1">
            <dt className="text-neutral-500">Telefone</dt>
            <dd>{formatarTelefone(lead.valor.telefoneE164)}</dd>
          </div>
          <div className="flex justify-between border-b py-1">
            <dt className="text-neutral-500">Email</dt>
            <dd>{lead.valor.email ?? '—'}</dd>
          </div>
          <div className="flex justify-between border-b py-1">
            <dt className="text-neutral-500">Empresa</dt>
            <dd>{lead.valor.empresa ?? '—'}</dd>
          </div>
          <div className="flex justify-between border-b py-1">
            <dt className="text-neutral-500">Valor</dt>
            <dd>{formatarMoeda(lead.valor.valorCents)}</dd>
          </div>
          <div className="flex justify-between border-b py-1">
            <dt className="text-neutral-500">Responsável</dt>
            <dd>
              {lead.valor.responsavelId ? nomePessoa.get(lead.valor.responsavelId) ?? '—' : '—'}
            </dd>
          </div>
        </dl>

        <div>
          <h2 className="mb-1 text-sm font-semibold">Etiquetas</h2>
          <EditorEtiquetas
            leadId={lead.valor.id}
            atuais={lead.valor.etiquetas}
            conhecidas={etiquetas.valor}
          />
        </div>

        <AcoesLead
          lead={lead.valor}
          etapas={pipeline.valor.etapas}
          membros={membros.valor}
          motivos={motivos.valor}
          etiquetasConhecidas={etiquetas.valor}
          podeTrocarResponsavel={papel !== 'vendedor'}
        />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">Linha do tempo</h2>
        <FormularioNota leadId={lead.valor.id} />
        <Timeline eventos={eventos.valor} nomeEtapa={nomeEtapa} nomePessoa={nomePessoa} />
      </section>
    </div>
  )
}
```

Create `src/app/(app)/leads/[id]/nota.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { adicionarNota } from './acoes'

export function FormularioNota({ leadId }: { leadId: string }) {
  const [texto, setTexto] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  async function salvar() {
    const r = await adicionarNota(leadId, texto)
    if (!r.ok) setErro(r.erro === 'nota_vazia' ? 'Escreva algo antes de salvar.' : r.erro)
    else {
      setErro(null)
      setTexto('')
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="registrar uma nota"
        rows={2}
        className="rounded border p-2 text-sm"
      />
      <button
        type="button"
        onClick={salvar}
        className="self-start rounded bg-black px-3 py-1 text-sm text-white"
      >
        Salvar nota
      </button>
      {erro && <p className="text-sm text-red-600">{erro}</p>}
    </div>
  )
}
```

- [ ] **Step 12: Verificar no navegador**

```bash
npm run dev
```

Clicar no nome de um lead no Kanban. Esperado: ficha abre com dados, etiquetas e a timeline mostrando, do mais recente para o mais antigo: `Etapa alterada: Novo lead → Perdido`, `Etiqueta "Preço alto" aplicada em Novo lead`, `Lead criado (origem: manual)`. Registrar uma nota e ver aparecer no topo. Trocar o responsável pelo select e conferir a nova linha `Responsável alterado para ...` na timeline. Mover a etapa pelo select "Mover para" escolhendo `Perdido`: o modal deve exigir o motivo.

- [ ] **Step 13: Rodar a suíte e commitar**

```bash
npm test && npm run test:integration && npm run typecheck
git add -A
git commit -m "feat: ficha do lead com timeline, notas e etiquetas"
```

Expected: 41 unitários e 31 de integração passando.

---

### Task 5: Configuração — etapas, motivos de perda e usuários

**Files:**
- Create: `src/lib/data/admin.ts`
- Create: `src/app/(app)/config/page.tsx`
- Create: `src/app/(app)/config/acoes.ts`
- Create: `src/app/(app)/config/etapas.tsx`
- Create: `src/app/(app)/config/motivos.tsx`
- Create: `src/app/(app)/config/usuarios.tsx`
- Test: `tests/integration/admin-store.test.ts`

**Interfaces:**
- Consumes: `criarClienteServidor`, `criarStoreDoServidor`, tipos de domínio.
- Produces:
  - `AdminStore` (port separado do `CrmStore`, porque só admin usa e a configuração não pertence ao fluxo do funil):
    ```ts
    interface AdminStore {
      criarEtapa(nome: string, tipo: StageTipo): Promise<Resultado<string>>
      renomearEtapa(etapaId: string, nome: string): Promise<Resultado<void>>
      reordenarEtapas(idsNaOrdem: string[]): Promise<Resultado<void>>
      criarMotivo(nome: string): Promise<Resultado<string>>
      alternarMotivo(motivoId: string, ativo: boolean): Promise<Resultado<void>>
      todosMotivos(): Promise<Resultado<MotivoPerda[]>>
      convidar(email: string, papel: Papel): Promise<Resultado<string>>
      convitesPendentes(): Promise<Resultado<Convite[]>>
      revogarConvite(conviteId: string): Promise<Resultado<void>>
    }
    ```
  - `type Convite = { id: string; email: string; papel: Papel; token: string; expiraEm: Date }`
  - `SupabaseAdminStore` implementando-a e `criarAdminStoreDoServidor(): Promise<Resultado<{ admin: SupabaseAdminStore; conta: Conta }>>`.

- [ ] **Step 1: Escrever os testes de integração do AdminStore**

Create `tests/integration/admin-store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SupabaseAdminStore } from '@/lib/data/admin'
import { comoServico, limparBanco } from './helpers/db'
import { montarCenario, type Cenario } from './helpers/cenario'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

async function clienteDoUsuario(userId: string) {
  const { SignJWT } = await import('jose')
  const segredo = new TextEncoder().encode(
    'super-secret-jwt-token-with-at-least-32-characters-long',
  )
  const token = await new SignJWT({ sub: userId, role: 'authenticated', aud: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(segredo)
  return createClient(URL, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

describe('SupabaseAdminStore', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  it('admin cria etapa no fim do funil', async () => {
    const admin = new SupabaseAdminStore(
      await clienteDoUsuario(c.adminId),
      c.accountId,
      c.adminId,
      c.pipelineId,
    )
    const r = await admin.criarEtapa('Negociação', 'aberta')
    expect(r.ok).toBe(true)

    const total = await comoServico(async (cli) =>
      (
        await cli.query('select count(*)::int as n from public.stages where pipeline_id = $1', [
          c.pipelineId,
        ])
      ).rows[0].n,
    )
    expect(total).toBe(8)
  })

  it('reordenar etapas nao viola o indice unico de ordem', async () => {
    const admin = new SupabaseAdminStore(
      await clienteDoUsuario(c.adminId),
      c.accountId,
      c.adminId,
      c.pipelineId,
    )
    const invertida = [...c.etapas].reverse().map((e) => e.id)

    const r = await admin.reordenarEtapas(invertida)
    expect(r.ok).toBe(true)

    const nomes = await comoServico(async (cli) =>
      (
        await cli.query(
          'select nome from public.stages where pipeline_id = $1 order by ordem',
          [c.pipelineId],
        )
      ).rows.map((x) => x.nome),
    )
    expect(nomes[0]).toBe('Perdido')
    expect(nomes[6]).toBe('Novo lead')
  })

  it('vendedor nao cria etapa', async () => {
    const admin = new SupabaseAdminStore(
      await clienteDoUsuario(c.vendedorAId),
      c.accountId,
      c.vendedorAId,
      c.pipelineId,
    )
    const r = await admin.criarEtapa('Hackeada', 'aberta')
    expect(r.ok).toBe(false)
  })

  it('convite pendente aparece na listagem e some ao revogar', async () => {
    const admin = new SupabaseAdminStore(
      await clienteDoUsuario(c.adminId),
      c.accountId,
      c.adminId,
      c.pipelineId,
    )
    const criado = await admin.convidar('novo@exemplo.com', 'vendedor')
    if (!criado.ok) throw new Error(criado.erro)

    const pendentes = await admin.convitesPendentes()
    if (!pendentes.ok) throw new Error(pendentes.erro)
    expect(pendentes.valor.map((p) => p.email)).toEqual(['novo@exemplo.com'])

    const revogado = await admin.revogarConvite(pendentes.valor[0].id)
    expect(revogado.ok).toBe(true)

    const depois = await admin.convitesPendentes()
    if (!depois.ok) throw new Error(depois.erro)
    expect(depois.valor).toHaveLength(0)
  })

  it('desativar motivo o remove das opcoes de perda', async () => {
    const admin = new SupabaseAdminStore(
      await clienteDoUsuario(c.adminId),
      c.accountId,
      c.adminId,
      c.pipelineId,
    )
    const r = await admin.alternarMotivo(c.motivoId, false)
    expect(r.ok).toBe(true)

    const ativos = await comoServico(async (cli) =>
      (
        await cli.query(
          'select count(*)::int as n from public.loss_reasons where account_id = $1 and ativo',
          [c.accountId],
        )
      ).rows[0].n,
    )
    expect(ativos).toBe(4)
  })

  it('todosMotivos continua listando o motivo desativado', async () => {
    const admin = new SupabaseAdminStore(
      await clienteDoUsuario(c.adminId),
      c.accountId,
      c.adminId,
      c.pipelineId,
    )
    await admin.alternarMotivo(c.motivoId, false)

    const r = await admin.todosMotivos()
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor).toHaveLength(5)
    expect(r.valor.find((m) => m.id === c.motivoId)?.ativo).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:integration -- tests/integration/admin-store.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/data/admin"`.

- [ ] **Step 3: Implementar o AdminStore**

Create `src/lib/data/admin.ts`:

```ts
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import type { Conta, MotivoPerda, Papel, StageTipo } from '@/lib/domain/tipos'
import { criarClienteServidor } from '@/lib/supabase/servidor'

export type Convite = {
  id: string
  email: string
  papel: Papel
  token: string
  expiraEm: Date
}

export interface AdminStore {
  criarEtapa(nome: string, tipo: StageTipo): Promise<Resultado<string>>
  renomearEtapa(etapaId: string, nome: string): Promise<Resultado<void>>
  reordenarEtapas(idsNaOrdem: string[]): Promise<Resultado<void>>
  criarMotivo(nome: string): Promise<Resultado<string>>
  alternarMotivo(motivoId: string, ativo: boolean): Promise<Resultado<void>>
  /** Inclui os inativos — a tela de configuracao precisa deles para reativar. */
  todosMotivos(): Promise<Resultado<MotivoPerda[]>>
  convidar(email: string, papel: Papel): Promise<Resultado<string>>
  convitesPendentes(): Promise<Resultado<Convite[]>>
  revogarConvite(conviteId: string): Promise<Resultado<void>>
}

const DIAS_DE_VALIDADE = 7

export class SupabaseAdminStore implements AdminStore {
  constructor(
    private readonly cliente: SupabaseClient,
    private readonly accountId: string,
    private readonly usuarioId: string,
    private readonly pipelineId: string,
  ) {}

  async criarEtapa(nome: string, tipo: StageTipo): Promise<Resultado<string>> {
    const { data: ultima, error: erroMax } = await this.cliente
      .from('stages')
      .select('ordem')
      .eq('pipeline_id', this.pipelineId)
      .order('ordem', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (erroMax) return falha(erroMax.message)

    const { data, error } = await this.cliente
      .from('stages')
      .insert({
        pipeline_id: this.pipelineId,
        nome,
        tipo,
        ordem: (ultima?.ordem ?? 0) + 1,
      })
      .select('id')
      .single()
    if (error) return falha(error.message)
    return ok(data.id)
  }

  async renomearEtapa(etapaId: string, nome: string): Promise<Resultado<void>> {
    const { error } = await this.cliente.from('stages').update({ nome }).eq('id', etapaId)
    if (error) return falha(error.message)
    return ok(undefined)
  }

  async reordenarEtapas(idsNaOrdem: string[]): Promise<Resultado<void>> {
    // stages_ordem_por_pipeline e unico: escrevemos numa faixa alta primeiro
    // para nao colidir com as ordens que ainda nao foram reescritas.
    for (let i = 0; i < idsNaOrdem.length; i++) {
      const { error } = await this.cliente
        .from('stages')
        .update({ ordem: 1000 + i })
        .eq('id', idsNaOrdem[i])
      if (error) return falha(error.message)
    }
    for (let i = 0; i < idsNaOrdem.length; i++) {
      const { error } = await this.cliente
        .from('stages')
        .update({ ordem: i + 1 })
        .eq('id', idsNaOrdem[i])
      if (error) return falha(error.message)
    }
    return ok(undefined)
  }

  async criarMotivo(nome: string): Promise<Resultado<string>> {
    const { data, error } = await this.cliente
      .from('loss_reasons')
      .insert({ account_id: this.accountId, nome })
      .select('id')
      .single()
    if (error) return falha(error.message)
    return ok(data.id)
  }

  async alternarMotivo(motivoId: string, ativo: boolean): Promise<Resultado<void>> {
    const { error } = await this.cliente
      .from('loss_reasons')
      .update({ ativo })
      .eq('id', motivoId)
    if (error) return falha(error.message)
    return ok(undefined)
  }

  async todosMotivos(): Promise<Resultado<MotivoPerda[]>> {
    const { data, error } = await this.cliente
      .from('loss_reasons')
      .select('id, nome, ativo')
      .eq('account_id', this.accountId)
      .order('nome')
    if (error) return falha(error.message)
    return ok(data ?? [])
  }

  async convidar(email: string, papel: Papel): Promise<Resultado<string>> {
    const token = randomUUID().replace(/-/g, '')
    const expiraEm = new Date(Date.now() + DIAS_DE_VALIDADE * 86_400_000)

    const { data, error } = await this.cliente
      .from('invites')
      .insert({
        account_id: this.accountId,
        email: email.trim().toLowerCase(),
        papel,
        token,
        expira_em: expiraEm.toISOString(),
        criado_por: this.usuarioId,
      })
      .select('token')
      .single()
    if (error) return falha(error.message)
    return ok(data.token)
  }

  async convitesPendentes(): Promise<Resultado<Convite[]>> {
    const { data, error } = await this.cliente
      .from('invites')
      .select('id, email, papel, token, expira_em')
      .eq('account_id', this.accountId)
      .is('aceito_em', null)
      .order('criado_em', { ascending: false })
    if (error) return falha(error.message)
    return ok(
      (data ?? []).map((i) => ({
        id: i.id,
        email: i.email,
        papel: i.papel as Papel,
        token: i.token,
        expiraEm: new Date(i.expira_em),
      })),
    )
  }

  async revogarConvite(conviteId: string): Promise<Resultado<void>> {
    const { error } = await this.cliente.from('invites').delete().eq('id', conviteId)
    if (error) return falha(error.message)
    return ok(undefined)
  }
}

export async function criarAdminStoreDoServidor(): Promise<
  Resultado<{ admin: SupabaseAdminStore; conta: Conta }>
> {
  const cliente = await criarClienteServidor()
  const { data: sessao } = await cliente.auth.getUser()
  if (!sessao.user) return falha('sem_sessao')

  const { data, error } = await cliente
    .from('memberships')
    .select('papel, accounts(id, nome)')
    .limit(1)
    .maybeSingle()
  if (error) return falha(error.message)
  if (!data) return falha('sem_conta')

  const linha = data as unknown as { papel: Papel; accounts: { id: string; nome: string } }
  if (linha.papel !== 'admin') return falha('sem_permissao')

  const { data: pipeline, error: erroPipeline } = await cliente
    .from('pipelines')
    .select('id')
    .eq('account_id', linha.accounts.id)
    .eq('is_default', true)
    .maybeSingle()
  if (erroPipeline) return falha(erroPipeline.message)
  if (!pipeline) return falha('pipeline_nao_encontrado')

  return ok({
    admin: new SupabaseAdminStore(cliente, linha.accounts.id, sessao.user.id, pipeline.id),
    conta: { id: linha.accounts.id, nome: linha.accounts.nome },
  })
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
npx supabase db reset
npm run test:integration
```

Expected: PASS — 37 testes.

- [ ] **Step 5: Escrever as Server Actions de configuração**

Create `src/app/(app)/config/acoes.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { criarAdminStoreDoServidor } from '@/lib/data/admin'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import type { Papel, StageTipo } from '@/lib/domain/tipos'

export async function criarEtapaAction(nome: string, tipo: StageTipo): Promise<Resultado<void>> {
  const contexto = await criarAdminStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)
  const limpo = nome.trim()
  if (!limpo) return falha('nome_obrigatorio')

  const r = await contexto.valor.admin.criarEtapa(limpo, tipo)
  if (!r.ok) return falha(r.erro)
  revalidatePath('/config')
  revalidatePath('/funil')
  return ok(undefined)
}

export async function renomearEtapaAction(etapaId: string, nome: string): Promise<Resultado<void>> {
  const contexto = await criarAdminStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)
  const limpo = nome.trim()
  if (!limpo) return falha('nome_obrigatorio')

  const r = await contexto.valor.admin.renomearEtapa(etapaId, limpo)
  if (!r.ok) return falha(r.erro)
  revalidatePath('/config')
  revalidatePath('/funil')
  return ok(undefined)
}

export async function reordenarEtapasAction(idsNaOrdem: string[]): Promise<Resultado<void>> {
  const contexto = await criarAdminStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)

  const r = await contexto.valor.admin.reordenarEtapas(idsNaOrdem)
  if (!r.ok) return falha(r.erro)
  revalidatePath('/config')
  revalidatePath('/funil')
  return ok(undefined)
}

export async function criarMotivoAction(nome: string): Promise<Resultado<void>> {
  const contexto = await criarAdminStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)
  const limpo = nome.trim()
  if (!limpo) return falha('nome_obrigatorio')

  const r = await contexto.valor.admin.criarMotivo(limpo)
  if (!r.ok) return falha(r.erro)
  revalidatePath('/config')
  return ok(undefined)
}

export async function alternarMotivoAction(
  motivoId: string,
  ativo: boolean,
): Promise<Resultado<void>> {
  const contexto = await criarAdminStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)

  const r = await contexto.valor.admin.alternarMotivo(motivoId, ativo)
  if (!r.ok) return falha(r.erro)
  revalidatePath('/config')
  return ok(undefined)
}

export async function convidarAction(email: string, papel: Papel): Promise<Resultado<string>> {
  const contexto = await criarAdminStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)
  const limpo = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpo)) return falha('email_invalido')

  const r = await contexto.valor.admin.convidar(limpo, papel)
  if (!r.ok) return falha(r.erro)
  revalidatePath('/config')
  return ok(r.valor)
}

export async function revogarConviteAction(conviteId: string): Promise<Resultado<void>> {
  const contexto = await criarAdminStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)

  const r = await contexto.valor.admin.revogarConvite(conviteId)
  if (!r.ok) return falha(r.erro)
  revalidatePath('/config')
  return ok(undefined)
}
```

- [ ] **Step 6: Escrever os componentes de configuração**

Create `src/app/(app)/config/etapas.tsx`:

```tsx
'use client'

import { useState } from 'react'
import type { Etapa, StageTipo } from '@/lib/domain/tipos'
import { criarEtapaAction, renomearEtapaAction, reordenarEtapasAction } from './acoes'

export function Etapas({ etapas }: { etapas: Etapa[] }) {
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState<StageTipo>('aberta')
  const [erro, setErro] = useState<string | null>(null)

  async function mover(indice: number, direcao: -1 | 1) {
    const destino = indice + direcao
    if (destino < 0 || destino >= etapas.length) return
    const ids = etapas.map((e) => e.id)
    ;[ids[indice], ids[destino]] = [ids[destino], ids[indice]]
    const r = await reordenarEtapasAction(ids)
    if (!r.ok) setErro(r.erro)
  }

  return (
    <section>
      <h2 className="mb-2 font-semibold">Etapas do funil</h2>
      <ul className="flex flex-col gap-1">
        {etapas.map((e, i) => (
          <li key={e.id} className="flex items-center gap-2 rounded border p-2 text-sm">
            <input
              defaultValue={e.nome}
              onBlur={async (ev) => {
                if (ev.target.value !== e.nome) {
                  const r = await renomearEtapaAction(e.id, ev.target.value)
                  if (!r.ok) setErro(r.erro)
                }
              }}
              className="flex-1 rounded border px-2 py-1"
            />
            <span className="text-xs text-neutral-500">{e.tipo}</span>
            <button type="button" onClick={() => mover(i, -1)} aria-label="subir">
              ↑
            </button>
            <button type="button" onClick={() => mover(i, 1)} aria-label="descer">
              ↓
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex gap-2">
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="nova etapa"
          className="rounded border px-2 py-1 text-sm"
        />
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value as StageTipo)}
          className="rounded border px-2 py-1 text-sm"
        >
          <option value="aberta">aberta</option>
          <option value="ganho">ganho</option>
          <option value="perdido">perdido</option>
        </select>
        <button
          type="button"
          onClick={async () => {
            const r = await criarEtapaAction(nome, tipo)
            if (!r.ok) setErro(r.erro)
            else {
              setErro(null)
              setNome('')
            }
          }}
          className="rounded bg-black px-3 py-1 text-sm text-white"
        >
          Adicionar
        </button>
      </div>
      {erro && <p className="mt-1 text-sm text-red-600">{erro}</p>}
    </section>
  )
}
```

Create `src/app/(app)/config/motivos.tsx`:

```tsx
'use client'

import { useState } from 'react'
import type { MotivoPerda } from '@/lib/domain/tipos'
import { alternarMotivoAction, criarMotivoAction } from './acoes'

export function Motivos({ motivos }: { motivos: MotivoPerda[] }) {
  const [nome, setNome] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  return (
    <section>
      <h2 className="mb-2 font-semibold">Motivos de perda</h2>
      <ul className="flex flex-col gap-1">
        {motivos.map((m) => (
          <li key={m.id} className="flex items-center justify-between rounded border p-2 text-sm">
            <span className={m.ativo ? undefined : 'text-neutral-400 line-through'}>{m.nome}</span>
            <button
              type="button"
              onClick={async () => {
                const r = await alternarMotivoAction(m.id, !m.ativo)
                if (!r.ok) setErro(r.erro)
              }}
              className="text-xs underline"
            >
              {m.ativo ? 'desativar' : 'reativar'}
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex gap-2">
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="novo motivo"
          className="rounded border px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={async () => {
            const r = await criarMotivoAction(nome)
            if (!r.ok) setErro(r.erro)
            else {
              setErro(null)
              setNome('')
            }
          }}
          className="rounded bg-black px-3 py-1 text-sm text-white"
        >
          Adicionar
        </button>
      </div>
      {erro && <p className="mt-1 text-sm text-red-600">{erro}</p>}
    </section>
  )
}
```

Create `src/app/(app)/config/usuarios.tsx`:

```tsx
'use client'

import { useState } from 'react'
import type { Membro, Papel } from '@/lib/domain/tipos'
import type { Convite } from '@/lib/data/admin'
import { convidarAction, revogarConviteAction } from './acoes'

export function Usuarios({
  membros,
  convites,
  origem,
}: {
  membros: Membro[]
  convites: Convite[]
  origem: string
}) {
  const [email, setEmail] = useState('')
  const [papel, setPapel] = useState<Papel>('vendedor')
  const [link, setLink] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  return (
    <section>
      <h2 className="mb-2 font-semibold">Usuários</h2>
      <ul className="flex flex-col gap-1">
        {membros.map((m) => (
          <li key={m.id} className="flex items-center justify-between rounded border p-2 text-sm">
            <span>
              {m.nome} <span className="text-neutral-500">({m.email})</span>
            </span>
            <span className="text-xs text-neutral-500">{m.papel}</span>
          </li>
        ))}
      </ul>

      {convites.length > 0 && (
        <>
          <h3 className="mt-3 text-sm font-medium">Convites pendentes</h3>
          <ul className="flex flex-col gap-1">
            {convites.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between rounded border border-dashed p-2 text-sm"
              >
                <span>
                  {c.email} <span className="text-xs text-neutral-500">({c.papel})</span>
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    const r = await revogarConviteAction(c.id)
                    if (!r.ok) setErro(r.erro)
                  }}
                  className="text-xs underline"
                >
                  revogar
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="mt-3 flex gap-2">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email do convidado"
          className="rounded border px-2 py-1 text-sm"
        />
        <select
          value={papel}
          onChange={(e) => setPapel(e.target.value as Papel)}
          className="rounded border px-2 py-1 text-sm"
        >
          <option value="vendedor">vendedor</option>
          <option value="gestor">gestor</option>
          <option value="admin">admin</option>
        </select>
        <button
          type="button"
          onClick={async () => {
            const r = await convidarAction(email, papel)
            if (!r.ok) {
              setErro(r.erro === 'email_invalido' ? 'Email inválido.' : r.erro)
              return
            }
            setErro(null)
            setEmail('')
            setLink(`${origem}/convite/${r.valor}`)
          }}
          className="rounded bg-black px-3 py-1 text-sm text-white"
        >
          Convidar
        </button>
      </div>

      {link && (
        <p className="mt-2 rounded bg-neutral-100 p-2 text-sm">
          Envie este link ao convidado: <code className="break-all">{link}</code>
        </p>
      )}
      {erro && <p className="mt-1 text-sm text-red-600">{erro}</p>}
    </section>
  )
}
```

- [ ] **Step 7: Escrever a página de configuração**

Create `src/app/(app)/config/page.tsx`:

```tsx
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import { criarAdminStoreDoServidor } from '@/lib/data/admin'
import { Etapas } from './etapas'
import { Motivos } from './motivos'
import { Usuarios } from './usuarios'

export default async function ConfigPage() {
  const contexto = await criarStoreDoServidor()
  if (!contexto.ok) redirect('/login')
  if (contexto.valor.papel !== 'admin') {
    return <p className="p-6 text-sm">Só administradores acessam a configuração.</p>
  }

  const adminContexto = await criarAdminStoreDoServidor()
  if (!adminContexto.ok) throw new Error(adminContexto.erro)

  const { store } = contexto.valor
  const [pipeline, membros, convites] = await Promise.all([
    store.pipelinePadrao(),
    store.membros(),
    adminContexto.valor.admin.convitesPendentes(),
  ])
  if (!pipeline.ok) throw new Error(pipeline.erro)
  if (!membros.ok) throw new Error(membros.erro)
  if (!convites.ok) throw new Error(convites.erro)

  // store.motivosPerda() so devolve ativos, que e o certo para o modal de perda.
  // A configuracao precisa dos inativos tambem, para poder reativar.
  const motivos = await adminContexto.valor.admin.todosMotivos()
  if (!motivos.ok) throw new Error(motivos.erro)

  const cabecalhos = await headers()
  const origem = `${cabecalhos.get('x-forwarded-proto') ?? 'http'}://${cabecalhos.get('host')}`

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 p-6">
      <h1 className="text-2xl font-semibold">Configuração</h1>
      <Etapas etapas={pipeline.valor.etapas} />
      <Motivos motivos={motivos.valor} />
      <Usuarios membros={membros.valor} convites={convites.valor} origem={origem} />
    </div>
  )
}
```

- [ ] **Step 8: Acrescentar o link de navegação**

Modify `src/app/(app)/layout.tsx` — trocar o `<header>` por:

```tsx
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-4">
          <span className="font-semibold">{r.valor.conta.nome}</span>
          <a href="/funil" className="text-sm underline">
            Funil
          </a>
          {r.valor.papel === 'admin' && (
            <a href="/config" className="text-sm underline">
              Configuração
            </a>
          )}
        </div>
        <form action={sair}>
          <button type="submit" className="text-sm underline">
            Sair
          </button>
        </form>
      </header>
```

- [ ] **Step 9: Verificar no navegador**

```bash
npm run dev
```

Em `/config`: renomear "Fechamento" para "Negociação final" e conferir que a coluna muda em `/funil`; desativar o motivo "Preço" e conferir que ele some do modal de perda; convidar `teste@exemplo.com` como vendedor e copiar o link gerado. Abrir o link numa janela anônima, criar conta e conferir que cai em `/funil` com o nome da conta "Empresa Exemplo" no topo e sem o link de Configuração.

- [ ] **Step 10: Commit**

```bash
npm test && npm run test:integration && npm run typecheck
git add -A
git commit -m "feat: configuracao de etapas, motivos de perda e convite de usuarios"
```

---

### Task 6: Smoke E2E com Playwright

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/funil.spec.ts`
- Modify: `package.json` (script `test:e2e`)

**Interfaces:**
- Consumes: a aplicação inteira rodando em `http://localhost:3000` contra o Supabase local.
- Produces: um único caminho E2E — signup → cadastrar lead → arrastar pelo funil → perder com motivo → conferir a timeline.

- [ ] **Step 1: Instalar o Playwright**

```bash
npm install -D @playwright/test
npx playwright install chromium
```

- [ ] **Step 2: Configurar o Playwright**

Create `playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:3000' },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/login',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
```

Adicionar ao `package.json`:

```json
    "test:e2e": "playwright test"
```

- [ ] **Step 3: Escrever o teste E2E**

Create `tests/e2e/funil.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

// Email unico por execucao: o banco local nao e limpo entre rodadas de E2E.
const carimbo = Date.now()
const EMAIL = `e2e-${carimbo}@exemplo.com`
const SENHA = 'segredo123'

test('do signup ate a perda com motivo, com a timeline contando a historia', async ({ page }) => {
  await page.goto('/signup')
  await page.getByPlaceholder('seu nome').fill('Pedro E2E')
  await page.getByPlaceholder('nome da empresa').fill(`Empresa ${carimbo}`)
  await page.getByPlaceholder('email').fill(EMAIL)
  await page.getByPlaceholder('senha (min. 8 caracteres)').fill(SENHA)
  await page.getByRole('button', { name: 'Criar conta' }).click()

  await expect(page).toHaveURL(/\/funil/)
  await expect(page.getByRole('heading', { name: 'Novo lead', level: 2 })).toBeVisible()

  await page.getByRole('button', { name: 'Novo lead' }).click()
  await page.getByPlaceholder('nome').fill('Cliente Teste')
  await page.getByPlaceholder('telefone').fill('(83) 99999-1234')
  await page.getByRole('button', { name: 'Salvar' }).click()

  const cartao = page.getByRole('link', { name: 'Cliente Teste' })
  await expect(cartao).toBeVisible()

  // Arrastar de "Novo lead" para "Qualificação".
  const colunaQualificacao = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Qualificação' }) })
  await cartao.hover()
  await page.mouse.down()
  await colunaQualificacao.hover()
  await page.mouse.up()

  await expect(page.getByRole('heading', { name: /Cliente Teste → Qualificação/ })).toBeVisible()
  await page.getByPlaceholder('digite e pressione Enter').fill('Preço alto')
  await page.getByPlaceholder('digite e pressione Enter').press('Enter')
  await page.getByRole('button', { name: 'Confirmar' }).click()

  // Arrastar para "Perdido": o Confirmar so libera depois de escolher o motivo.
  const colunaPerdido = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Perdido' }) })
  await page.getByRole('link', { name: 'Cliente Teste' }).hover()
  await page.mouse.down()
  await colunaPerdido.hover()
  await page.mouse.up()

  await expect(page.getByRole('button', { name: 'Confirmar' })).toBeDisabled()
  await page.getByRole('combobox').first().selectOption({ label: 'Preço' })
  await page.getByRole('button', { name: 'Confirmar' }).click()

  await page.getByRole('link', { name: 'Cliente Teste' }).click()
  await expect(page.getByRole('heading', { name: 'Cliente Teste', level: 1 })).toBeVisible()
  await expect(page.getByText('Etapa alterada: Qualificação → Perdido')).toBeVisible()
  await expect(page.getByText('Etiqueta "Preço alto" aplicada em Novo lead')).toBeVisible()
  await expect(page.getByText('Lead criado (origem: manual)')).toBeVisible()
})
```

- [ ] **Step 4: Rodar o E2E**

```bash
npx supabase start
npm run test:e2e
```

Expected: PASS — 1 teste.

- [ ] **Step 5: Rodar a suíte completa**

```bash
npm test && npm run test:integration && npm run typecheck && npm run build && npm run test:e2e
```

Expected: 41 unitários, 37 de integração, 1 E2E; typecheck e build limpos.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test: smoke E2E do funil do signup ate a perda com motivo"
```

---

## Pronto quando (critério da spec)

Você cria uma conta, convida um vendedor, ele entra e vê apenas os leads dele, cadastra um lead, arrasta pelo funil, etiqueta na qualificação, perde um lead com motivo obrigatório, e a timeline da ficha conta essa história inteira — com a suíte verde e as policies de RLS verificadas contra Postgres real.

## Próximos sub-projetos

2. **Ingestão automática** — webhooks Meta e Google, dedup contra leads abertos, `integration_log`, notificações Realtime.
3. **Métricas** — conversão entre etapas, distribuição de etiquetas por etapa, conversão por canal.
4. **Scripts de Venda + Tarefas.**

Cada um começa com seu próprio brainstorming, já sabendo como o núcleo ficou de verdade.
