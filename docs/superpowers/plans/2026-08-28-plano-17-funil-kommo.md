# Plano 17 — Funil estilo Kommo (card compacto, drawer do lead, mover entre pipelines)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O funil do Vostok passa a ter card compacto (nome/data/status · telefone/responsável · etiquetas), um drawer lateral do lead aberto por `?lead=<id>` com abas Principal · Tarefas · Histórico, e um seletor de pipeline/etapa no cabeçalho do drawer que move o lead inclusive para outra pipeline.

**Architecture:** O drawer é renderizado no servidor pela própria `funil/page.tsx` quando `?lead=` está presente (arquitetura A da spec); os componentes da ficha atual mudam de pasta para `funil/drawer/` e `/leads/[id]` vira redirect. Mover entre pipelines é uma RPC nova (`mover_lead_pipeline`, migration 0031) exposta por `CrmStore.moverParaPipeline` e `moverParaPipelineAction`, com a `move_lead_stage` emendada para recusar etapa de outra pipeline. Cores de etapa por posição, sem migration.

**Tech Stack:** Next.js 15 App Router (server components + server actions), Supabase/Postgres (plpgsql, RLS), vitest + Testing Library (jsdom por arquivo via `// @vitest-environment jsdom`), Playwright, Tailwind v4, dnd-kit (inalterado).

Spec: `docs/superpowers/specs/2026-08-28-crm-funil-kommo-design.md`.

## Global Constraints

- Card: linha 1 nome + `criadoEm` em `dd/MM/yyyy` no fuso `America/Sao_Paulo` (`FUSO_PADRAO` de `@/lib/domain/tarefa`) + bolinha 8px `bg-destructive` quando `horasNaEtapa(entrouNaEtapaEm, agora) >= 72`, senão `bg-muted-foreground/40`; linha 2 telefone (`formatarTelefone`) / responsável; linha 3 etiquetas. O valor NÃO aparece no card. A regra 72h não muda.
- O nome do card continua sendo um **link** (`<Link>` do Next) — os E2E localizam por `getByRole('link', { name })` e "abrir em nova aba" tem que funcionar; o href passa a ser o funil com `?lead=<id>` (`scroll={false}`).
- Drawer: `role="dialog"` `aria-modal="true"` `aria-labelledby` no nome; foco inicial no botão de fechar; Escape e clique no backdrop fecham; foco devolvido ao elemento que abriu. Abas Principal · Tarefas · Histórico com `role="tablist"`, setas esquerda/direita alternam.
- `/leads/[id]` → `redirect('/funil?pipeline=<pipelineId>&lead=<id>')` (pipeline padrão sem `pipeline=`); lead inexistente → `redirect('/funil')`.
- Migration `0031_mover_lead_pipeline.sql`: RPC `mover_lead_pipeline(p_lead_id uuid, p_stage_destino uuid, p_loss_reason_id uuid default null)`, `security invoker`, `set search_path = public`, `revoke execute from public` + `grant execute to authenticated`; erros `lead_nao_encontrado`, `etapa_invalida`, `mesma_pipeline`, `motivo_perda_obrigatorio`, `motivo_perda_invalido`; evento `pipeline_alterada` com payload `{de_pipeline, para_pipeline, de, para, loss_reason_id}`; `move_lead_stage` passa a exigir `s.pipeline_id = v_lead.pipeline_id`.
- Etiquetas aplicadas ANTES de mover (snapshot da etapa de origem), como `moverEtapaAction`.
- Cores por posição em `src/lib/domain/etapa-cor.ts`, classes Tailwind literais completas.
- Identificadores sem acento; comentários em português; testes afirmam estado (stores falsos, `MemoryStore`), não spies de módulo quando houver alternativa.
- Branch `plano-17-funil-kommo` a partir de `master`. Ao fim de cada task: `npm test`, `npm run typecheck`, `npm run lint` verdes. Integração (`npm run test:integration`) na Task 2. E2E na Task 4 e 5 (ordem: `test` → `test:integration` → `db:reset` → `test:e2e`; derrubar qualquer `next dev` antes).

---

### Task 1: Card compacto

**Files:**
- Modify: `src/lib/domain/tipos.ts:62-70` (`LeadDoFunil`)
- Modify: `src/lib/data/supabase.ts:352-380` (`leadsDoFunil`: mapear `telefone_e164`, `criado_em`) e `src/lib/data/memory.ts` (projeção equivalente) — verificar se a RPC `leads_do_funil` (0027) devolve `telefone_e164`/`criado_em`; se não, emendar a função na migration 0031 (Task 2) **não** — emendar aqui, em `0031_leads_do_funil_campos.sql`? Não: a Task 2 já cria a 0031. Regra: se a RPC não devolver as colunas, esta task cria `supabase/migrations/0031_leads_do_funil_campos.sql` (`create or replace function public.leads_do_funil` copiando a 0027 e acrescentando `l.telefone_e164, l.criado_em` ao `returns table` e ao `select`), e a Task 2 usa **0032**. Reportar no relatório qual caso ocorreu.
- Modify: `src/app/(app)/funil/cartao.tsx` (reescrever)
- Modify: `src/app/(app)/funil/quadro.tsx:67` (`containIntrinsicSize: 'auto 72px'`)
- Modify: `src/lib/domain/lead.ts` (novo `formatarDataCurta`)
- Test: `src/app/(app)/funil/cartao.test.tsx` (criar), `src/lib/domain/lead.test.ts` (acrescentar)

**Interfaces:**
- Produces: `LeadDoFunil` ganha `telefoneE164: string | null` e `criadoEm: Date`. `formatarDataCurta(d: Date): string` em `@/lib/domain/lead` → `dd/MM/yyyy` no `FUSO_PADRAO`. `Cartao({ lead, nomeResponsavel, href })` — `href` é a URL que o nome abre (Task 4 passa o `?lead=`; até lá `/leads/${id}`).

- [ ] **Step 1: Teste de `formatarDataCurta`**

```ts
// acrescentar em src/lib/domain/lead.test.ts
import { formatarDataCurta } from './lead'
describe('formatarDataCurta', () => {
  it('dd/MM/yyyy no fuso de Sao Paulo (23:30Z de 22/08 e' 20:30 de 22/08)', () => {
    expect(formatarDataCurta(new Date('2026-08-22T23:30:00Z'))).toBe('22/08/2026')
  })
  it('01:30Z de 23/08 ainda e' 22/08 em Sao Paulo', () => {
    expect(formatarDataCurta(new Date('2026-08-23T01:30:00Z'))).toBe('22/08/2026')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/lib/domain/lead.test.ts` → falha por export inexistente.

- [ ] **Step 3: Implementar**

```ts
// src/lib/domain/lead.ts (acrescentar)
import { FUSO_PADRAO } from './tarefa'
const DATA_CURTA = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: FUSO_PADRAO })
/** dd/MM/yyyy no fuso da operacao — a data que o cartao mostra a direita do nome. */
export function formatarDataCurta(d: Date): string {
  return DATA_CURTA.format(d)
}
```
(`dateStyle: 'short'` em pt-BR é `dd/MM/yyyy`; o teste pina.)

- [ ] **Step 4: Tipo e stores.** Em `tipos.ts`, `LeadDoFunil` ganha `telefoneE164: string | null` e `criadoEm: Date` (comentário: "o cartao mostra telefone e data de criacao — decisao da spec Kommo"). Em `supabase.ts`, no tipo da linha da RPC e no `map` de `leadsDoFunil`, acrescentar `telefone_e164: string | null`, `criado_em: string` → `telefoneE164`, `criadoEm: new Date(...)`. Em `memory.ts`, onde `LeadDoFunil` é projetado a partir de `Lead`, copiar `telefoneE164` e `criadoEm`. Conferir a RPC `leads_do_funil` na 0027 (ver nota em Files). `npm run typecheck` aponta todo lugar que constrói `LeadDoFunil` (testes de `quadro`, fixtures) — acrescentar os dois campos neles.

- [ ] **Step 5: Teste do card**

```tsx
// src/app/(app)/funil/cartao.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Cartao } from './cartao'
import type { LeadDoFunil } from '@/lib/domain/tipos'

afterEach(cleanup)

function lead(sobre: Partial<LeadDoFunil> = {}): LeadDoFunil {
  return {
    id: 'l1', nome: 'Kariny', stageId: 's1', responsavelId: 'u1', valorCents: 150000,
    entrouNaEtapaEm: new Date(), criadoEm: new Date('2026-08-19T15:00:00Z'),
    telefoneE164: '+5588999279950', etiquetas: [{ id: 't1', nome: 'Não responde' }],
    ...sobre,
  }
}

describe('Cartao', () => {
  it('nome como link para o href recebido, data de criacao, telefone, responsavel e etiqueta', () => {
    render(<Cartao lead={lead()} nomeResponsavel="Pedro Soares" href="/funil?lead=l1" />)
    expect(screen.getByRole('link', { name: 'Kariny' })).toHaveProperty('href', expect.stringContaining('/funil?lead=l1'))
    expect(screen.getByText('19/08/2026')).toBeTruthy()
    expect(screen.getByText('(88) 99927-9950')).toBeTruthy()
    expect(screen.getByText('Pedro Soares')).toBeTruthy()
    expect(screen.getByText('Não responde')).toBeTruthy()
    expect(screen.queryByText('R$ 1.500,00')).toBeNull()
  })
  it('sem telefone e sem responsavel: fallbacks', () => {
    render(<Cartao lead={lead({ telefoneE164: null })} nomeResponsavel={null} href="/x" />)
    expect(screen.getByText('sem telefone')).toBeTruthy()
    expect(screen.getByText('sem responsável')).toBeTruthy()
  })
  it('bolinha de parado so a partir de 72h na etapa', () => {
    const h71 = new Date(Date.now() - 71 * 3600_000)
    const h72 = new Date(Date.now() - 72 * 3600_000)
    const { unmount } = render(<Cartao lead={lead({ entrouNaEtapaEm: h71 })} nomeResponsavel={null} href="/x" />)
    expect(screen.getByLabelText(/na etapa há/).className).toContain('bg-muted-foreground/40')
    unmount()
    render(<Cartao lead={lead({ entrouNaEtapaEm: h72 })} nomeResponsavel={null} href="/x" />)
    expect(screen.getByLabelText(/parado há/i).className).toContain('bg-destructive')
  })
})
```
(`formatarTelefone('+5588999279950')` — conferir o formato exato que a função devolve e ajustar a string do teste; o formato é dela, não do card.)

- [ ] **Step 6: Rodar e ver falhar** — `npx vitest run "src/app/(app)/funil/cartao.test.tsx"`.

- [ ] **Step 7: Reescrever `cartao.tsx`**

```tsx
'use client'
import Link from 'next/link'
import type { LeadDoFunil } from '@/lib/domain/tipos'
import { formatarDataCurta, horasNaEtapa, rotuloTempoNaEtapa } from '@/lib/domain/lead'
import { formatarTelefone } from '@/lib/domain/formato'
import { Selo } from '@/components/ui/selo'

/**
 * Cartao no formato de referencia (Kommo): tres linhas, ~70px. O VALOR saiu
 * daqui de proposito (spec 2026-08-28-crm-funil-kommo): mora no cabecalho do
 * drawer. O tempo parado virou a bolinha de status — a regra (72h) e' a mesma.
 */
export function Cartao({ lead, nomeResponsavel, href }: { lead: LeadDoFunil; nomeResponsavel: string | null; href: string }) {
  const horas = horasNaEtapa(lead.entrouNaEtapaEm, new Date())
  const parado = horas >= 72
  const rotuloStatus = parado ? `Parado há ${rotuloTempoNaEtapa(horas)}` : `Na etapa há ${rotuloTempoNaEtapa(horas)}`
  return (
    <article className="surface pressable group rounded-2xl p-2.5 hover:border-primary/40">
      <div className="flex items-center justify-between gap-2">
        <Link href={href} scroll={false} className="min-w-0 truncate text-sm font-semibold text-foreground group-hover:text-primary">
          {lead.nome}
        </Link>
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="tabular">{formatarDataCurta(lead.criadoEm)}</span>
          <span role="img" aria-label={rotuloStatus} title={rotuloStatus}
            className={`inline-block h-2 w-2 rounded-full ${parado ? 'bg-destructive' : 'bg-muted-foreground/40'}`} />
        </span>
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2 text-[11px]">
        <span className="tabular truncate text-foreground/80">{lead.telefoneE164 ? formatarTelefone(lead.telefoneE164) : 'sem telefone'}</span>
        <span className="truncate text-muted-foreground">{nomeResponsavel ?? 'sem responsável'}</span>
      </div>
      {lead.etiquetas.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-1">
          {lead.etiquetas.map((e) => (<li key={e.id}><Selo tom="primario">{e.nome}</Selo></li>))}
        </ul>
      )}
    </article>
  )
}
```
Em `quadro.tsx`, `CartaoArrastavel` passa `href={`/leads/${lead.id}`}` (a Task 4 troca) e `containIntrinsicSize: 'auto 72px'`.

- [ ] **Step 8: Verificar** — `npx vitest run "src/app/(app)/funil"`, depois `npm test && npm run typecheck && npm run lint`. Testes existentes que afirmavam valor/`Clock` no card precisam de ajuste (relatar quais).

- [ ] **Step 9: Commit** — `git commit -m "feat(funil): cartao compacto (nome/data/status, telefone/responsavel, etiquetas)"`.

---

### Task 2: Mover entre pipelines — banco, store, action, timeline

**Files:**
- Create: `supabase/migrations/0031_mover_lead_pipeline.sql` (ou 0032, ver Task 1)
- Create: `tests/integration/0031_mover_lead_pipeline.test.ts`
- Modify: `tests/integration/0024_sweep_grants_rpc.test.ts:71` (mapa: `'mover_lead_pipeline(uuid,uuid,uuid)': { anon: false, authenticated: true }`)
- Modify: `src/lib/data/store.ts:81`, `src/lib/data/supabase.ts:469`, `src/lib/data/memory.ts:323`
- Modify: `src/app/(app)/funil/acoes.ts` (nova `moverParaPipelineAction`), `src/app/(app)/funil/erros.ts` (`mesma_pipeline`)
- Modify: `src/app/(app)/leads/[id]/timeline.tsx:18` (caso `pipeline_alterada`) — assinatura de `rotuloEvento`/`Timeline` ganha `nomePipeline: Map<string, string>`
- Test: `src/lib/data/memory.test.ts` (ou o arquivo que testa o MemoryStore — localizar por `moverEtapa`), `src/app/(app)/funil/acoes.test.ts`, `src/app/(app)/leads/[id]/timeline.test.tsx`

**Interfaces:**
- Produces: `CrmStore.moverParaPipeline(leadId: string, stageDestino: string, lossReasonId?: string | null): Promise<Resultado<void>>`; `moverParaPipelineAction(leadId, stageDestino, lossReasonId: string | null, etiquetas: string[]): Promise<Resultado<void>>`; `rotuloEvento(evento, nomeEtapa, nomePessoa, nomePipeline)` e `<Timeline eventos nomeEtapa nomePessoa nomePipeline />`.

- [ ] **Step 1: Migration**

```sql
-- supabase/migrations/0031_mover_lead_pipeline.sql
-- Mover um lead para OUTRA pipeline (spec 2026-08-28-crm-funil-kommo, Parte 3).
-- move_lead_stage (0004) so trocava stage_id e nunca conferia a pipeline da
-- etapa de destino: uma etapa de outra pipeline da mesma conta passava e
-- deixava pipeline_id/stage_id inconsistentes. Esta migration (1) cria a RPC
-- que troca os dois juntos e (2) fecha o buraco na antiga.

create or replace function public.mover_lead_pipeline(
  p_lead_id uuid,
  p_stage_destino uuid,
  p_loss_reason_id uuid default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_lead public.leads;
  v_stage public.stages;
  v_origem uuid;
  v_pipeline_origem uuid;
begin
  select * into v_lead from public.leads where id = p_lead_id for update;
  if v_lead.id is null then
    raise exception 'lead_nao_encontrado';
  end if;

  select s.* into v_stage
  from public.stages s
  join public.pipelines p on p.id = s.pipeline_id
  where s.id = p_stage_destino and p.account_id = v_lead.account_id;
  if v_stage.id is null then
    raise exception 'etapa_invalida';
  end if;
  -- Mesma pipeline e' trabalho de move_lead_stage; esta funcao existe para a
  -- troca de pipeline e nao deve virar um segundo caminho para o mesmo movimento.
  if v_stage.pipeline_id = v_lead.pipeline_id then
    raise exception 'mesma_pipeline';
  end if;

  if v_stage.tipo = 'perdido' then
    if p_loss_reason_id is null then
      raise exception 'motivo_perda_obrigatorio';
    end if;
    if not exists (
      select 1 from public.loss_reasons lr
      where lr.id = p_loss_reason_id and lr.account_id = v_lead.account_id and lr.ativo
    ) then
      raise exception 'motivo_perda_invalido';
    end if;
  end if;

  v_origem := v_lead.stage_id;
  v_pipeline_origem := v_lead.pipeline_id;

  update public.leads set
    pipeline_id = v_stage.pipeline_id,
    stage_id = p_stage_destino,
    status = (case v_stage.tipo when 'ganho' then 'ganho' when 'perdido' then 'perdido' else 'aberto' end)::public.lead_status,
    loss_reason_id = case when v_stage.tipo = 'perdido' then p_loss_reason_id else null end,
    entrou_na_etapa_em = now(),
    atualizado_em = now()
  where id = p_lead_id;

  insert into public.stage_history (lead_id, stage_origem, stage_destino, movido_por)
  values (p_lead_id, v_origem, p_stage_destino, auth.uid());

  insert into public.lead_events (lead_id, tipo, payload, ator_id)
  values (
    p_lead_id,
    'pipeline_alterada',
    jsonb_build_object(
      'de_pipeline', v_pipeline_origem, 'para_pipeline', v_stage.pipeline_id,
      'de', v_origem, 'para', p_stage_destino, 'loss_reason_id', p_loss_reason_id
    ),
    auth.uid()
  );
end;
$$;

revoke execute on function public.mover_lead_pipeline(uuid, uuid, uuid) from public;
grant execute on function public.mover_lead_pipeline(uuid, uuid, uuid) to authenticated;

-- (2) move_lead_stage passa a exigir etapa da MESMA pipeline. Corpo copiado
-- da 0004 com uma unica linha a mais no where.
create or replace function public.move_lead_stage(
  p_lead_id uuid,
  p_stage_destino uuid,
  p_loss_reason_id uuid default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_lead public.leads;
  v_stage public.stages;
  v_origem uuid;
begin
  select * into v_lead from public.leads where id = p_lead_id for update;
  if v_lead.id is null then
    raise exception 'lead_nao_encontrado';
  end if;

  select s.* into v_stage
  from public.stages s
  join public.pipelines p on p.id = s.pipeline_id
  where s.id = p_stage_destino
    and p.account_id = v_lead.account_id
    and s.pipeline_id = v_lead.pipeline_id; -- 0031: etapa de outra pipeline e' invalida aqui
  if v_stage.id is null then
    raise exception 'etapa_invalida';
  end if;

  if v_stage.tipo = 'perdido' then
    if p_loss_reason_id is null then
      raise exception 'motivo_perda_obrigatorio';
    end if;
    if not exists (
      select 1 from public.loss_reasons lr
      where lr.id = p_loss_reason_id and lr.account_id = v_lead.account_id and lr.ativo
    ) then
      raise exception 'motivo_perda_invalido';
    end if;
  end if;

  v_origem := v_lead.stage_id;

  update public.leads set
    stage_id = p_stage_destino,
    status = (case v_stage.tipo when 'ganho' then 'ganho' when 'perdido' then 'perdido' else 'aberto' end)::public.lead_status,
    loss_reason_id = case when v_stage.tipo = 'perdido' then p_loss_reason_id else null end,
    entrou_na_etapa_em = now(),
    atualizado_em = now()
  where id = p_lead_id;

  insert into public.stage_history (lead_id, stage_origem, stage_destino, movido_por)
  values (p_lead_id, v_origem, p_stage_destino, auth.uid());

  insert into public.lead_events (lead_id, tipo, payload, ator_id)
  values (p_lead_id, 'etapa_alterada',
    jsonb_build_object('de', v_origem, 'para', p_stage_destino, 'loss_reason_id', p_loss_reason_id),
    auth.uid());
end;
$$;
```
Antes de commitar: `diff` visual do corpo de `move_lead_stage` com a 0004 — a ÚNICA diferença é a linha do `where`. Se a 0004 tiver algo que este texto não reproduz (grants, comentários funcionais), copiar da 0004.

- [ ] **Step 2: Teste de integração**

```ts
// tests/integration/0031_mover_lead_pipeline.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { comoServico, comoUsuario, limparBanco } from './helpers/db'
import { montarCenario, criarLead, etapa, type Cenario } from './helpers/cenario'

/** Segunda pipeline da conta, criada pela mesma RPC que a UI usa (criar_pipeline). */
async function segundaPipeline(c: Cenario) {
  const pipelineId = await comoUsuario(c.adminId, async (cli) => {
    const r = await cli.query<{ id: string }>(`select public.criar_pipeline($1, $2) as id`, ['Pós-venda', ['Onboarding', 'Ativo']])
    return r.rows[0].id
  })
  const etapas = await comoServico(async (cli) =>
    (await cli.query<{ id: string; nome: string; tipo: string }>(
      'select id, nome, tipo from public.stages where pipeline_id = $1 order by ordem', [pipelineId])).rows)
  return { pipelineId, etapas }
}
// Conferir a assinatura real de criar_pipeline em supabase/migrations (0025 ou anterior)
// e ajustar os parametros acima; se a RPC nao existir, inserir pipeline+stages via comoServico.

describe('0031 mover_lead_pipeline', () => {
  let c: Cenario
  beforeEach(async () => { await limparBanco(); c = await montarCenario() })

  it('troca pipeline_id e stage_id juntos, zera o relogio da etapa, grava stage_history e evento pipeline_alterada', async () => {
    const { pipelineId, etapas } = await segundaPipeline(c)
    const leadId = await criarLead(c, 'Ana', c.vendedorAId, etapa(c, 'Novo lead'))
    await comoUsuario(c.adminId, (cli) => cli.query('select public.mover_lead_pipeline($1, $2)', [leadId, etapas[0].id]))
    const lead = await comoServico(async (cli) =>
      (await cli.query('select pipeline_id, stage_id, status, entrou_na_etapa_em > now() - interval \'5 seconds\' as recente from public.leads where id = $1', [leadId])).rows[0])
    expect(lead).toMatchObject({ pipeline_id: pipelineId, stage_id: etapas[0].id, status: 'aberto', recente: true })
    const hist = await comoServico(async (cli) =>
      (await cli.query('select stage_origem, stage_destino from public.stage_history where lead_id = $1', [leadId])).rows)
    expect(hist).toEqual([{ stage_origem: etapa(c, 'Novo lead'), stage_destino: etapas[0].id }])
    const ev = await comoServico(async (cli) =>
      (await cli.query(`select payload from public.lead_events where lead_id = $1 and tipo = 'pipeline_alterada'`, [leadId])).rows[0].payload)
    expect(ev).toMatchObject({ de_pipeline: c.pipelineId, para_pipeline: pipelineId, de: etapa(c, 'Novo lead'), para: etapas[0].id, loss_reason_id: null })
  })

  it('etapa da mesma pipeline: mesma_pipeline', async () => {
    const leadId = await criarLead(c, 'Ana', c.vendedorAId, etapa(c, 'Novo lead'))
    await expect(comoUsuario(c.adminId, (cli) => cli.query('select public.mover_lead_pipeline($1, $2)', [leadId, etapa(c, 'Qualificação')])))
      .rejects.toThrow('mesma_pipeline')
  })

  it('etapa de outra conta: etapa_invalida', async () => {
    // usar criarContaAvulsa + uma pipeline dela; padrao dos testes de isolamento existentes
  })

  it('etapa perdido sem motivo: motivo_perda_obrigatorio', async () => {
    // segundaPipeline + criar etapa tipo perdido nela via comoServico insert em stages; esperar rejects 'motivo_perda_obrigatorio'
  })

  it('vendedor nao move lead que nao ve: lead_nao_encontrado', async () => {
    const { etapas } = await segundaPipeline(c)
    const leadId = await criarLead(c, 'Ana', c.vendedorAId, etapa(c, 'Novo lead'))
    await expect(comoUsuario(c.vendedorBId, (cli) => cli.query('select public.mover_lead_pipeline($1, $2)', [leadId, etapas[0].id])))
      .rejects.toThrow('lead_nao_encontrado')
  })

  it('move_lead_stage recusa etapa de OUTRA pipeline (o buraco da 0004)', async () => {
    const { etapas } = await segundaPipeline(c)
    const leadId = await criarLead(c, 'Ana', c.vendedorAId, etapa(c, 'Novo lead'))
    await expect(comoUsuario(c.adminId, (cli) => cli.query('select public.move_lead_stage($1, $2)', [leadId, etapas[0].id])))
      .rejects.toThrow('etapa_invalida')
    const lead = await comoServico(async (cli) => (await cli.query('select pipeline_id, stage_id from public.leads where id = $1', [leadId])).rows[0])
    expect(lead).toEqual({ pipeline_id: c.pipelineId, stage_id: etapa(c, 'Novo lead') })
  })
})
```
Os dois `it` com comentário-esqueleto DEVEM ser escritos por completo pelo implementador seguindo o padrão dos vizinhos (`criarContaAvulsa` em `helpers/cenario.ts`; insert em `stages` com `tipo = 'perdido'`).

- [ ] **Step 3: Aplicar e rodar** — `npx supabase db reset` (aplica a migration), `npm run test:integration -- 0031` → passa; `npm run test:integration -- 0024` → falha até o mapa ganhar a linha nova; acrescentar; passa.

- [ ] **Step 4: Store.** `store.ts` (após `moverEtapa`): `moverParaPipeline(leadId: string, stageDestino: string, lossReasonId?: string | null): Promise<Resultado<void>>` com doc "troca pipeline e etapa juntas; `mesma_pipeline` manda usar moverEtapa". `supabase.ts`: cópia de `moverEtapa` chamando `rpc('mover_lead_pipeline', …)`. `memory.ts`: cópia de `moverEtapa` com, após `etapaPorId`, `if (destino.pipelineId === lead.pipelineId) return falha('mesma_pipeline')`, e no final `lead.pipelineId = destino.pipelineId` e evento `pipeline_alterada` com o payload da migration (`de_pipeline`, `para_pipeline`, `de`, `para`, `loss_reason_id`). Teste no arquivo do MemoryStore: move para etapa de outra pipeline (criar via `criarPipeline`) → `pipelineId`/`stageId` trocados e evento gravado; mesma pipeline → `mesma_pipeline`.

- [ ] **Step 5: Action.** Em `funil/acoes.ts`, `moverParaPipelineAction` = cópia de `moverEtapaAction` (linhas 77-120) trocando `store.moverEtapa` por `store.moverParaPipeline`; extrair o miolo comum em `async function moverComEtiquetas(store, leadId, etiquetas, mover: () => Promise<Resultado<void>>)` para as duas actions não duplicarem a lógica de `etiquetasSalvas`/`codigoEtiquetasSalvas`. Teste em `acoes.test.ts` seguindo o padrão do teste existente de `moverEtapaAction` (MemoryStore): etiquetas aplicadas com snapshot da etapa de ORIGEM e lead na pipeline nova. `erros.ts`: `mesma_pipeline: 'Esse lead já está nessa pipeline. Escolha uma etapa.'`.

- [ ] **Step 6: Timeline.** `rotuloEvento` ganha 4º parâmetro `nomePipeline: Map<string, string>` e o caso:
```ts
case 'pipeline_alterada': {
  const dePipe = nomePipeline.get(String(p.de_pipeline)) ?? '?'
  const paraPipe = nomePipeline.get(String(p.para_pipeline)) ?? '?'
  const de = p.de ? nomeEtapa.get(String(p.de)) ?? 'etapa removida' : 'início'
  const para = nomeEtapa.get(String(p.para)) ?? 'etapa removida'
  return `Movido de ${dePipe} · ${de} para ${paraPipe} · ${para}`
}
```
`Timeline` recebe e repassa `nomePipeline`. `page.tsx` de leads passa `new Map(pipelines.map(p => [p.id, p.nome]))` (temporário — a Task 4 substitui a página). Teste em `timeline.test.tsx`: evento `pipeline_alterada` renderiza "Movido de Comercial · Qualificação para Pós-venda · Onboarding".

- [ ] **Step 7: Verificar e commitar** — `npm test && npm run typecheck && npm run lint && npm run test:integration`. Commits: `feat(db): 0031 mover_lead_pipeline + move_lead_stage exige mesma pipeline`, `feat: moverParaPipeline no store, action e timeline`.

---

### Task 3: Primitivos — `params.ts`, `etapa-cor.ts`, `Drawer`

**Files:**
- Create: `src/app/(app)/funil/params.ts` + `params.test.ts`
- Create: `src/lib/domain/etapa-cor.ts` + `etapa-cor.test.ts`
- Create: `src/components/ui/drawer.tsx` + `drawer.test.tsx`
- Modify: `src/app/(app)/funil/barra-pipelines.tsx:24-30` (usar `hrefDoFunil` de `params.ts`)

**Interfaces:**
- Produces:
  ```ts
  // params.ts
  export function hrefDoFunil(queryAtual: string, mudancas: Record<string, string | null>): string
  // null remove a chave; retorna '/funil' quando a query fica vazia.
  // etapa-cor.ts
  export type CorDeEtapa = { fundo: string; texto: string }
  export function corDaEtapa(ordem: number, tipo: StageTipo): CorDeEtapa
  // drawer.tsx
  export function Drawer({ titulo, tituloId, aoFechar, children, cabecalho }: { titulo: string; tituloId: string; aoFechar: () => void; cabecalho?: ReactNode; children: ReactNode })
  ```

- [ ] **Step 1: Testes de `params.ts`**
```ts
import { describe, expect, it } from 'vitest'
import { hrefDoFunil } from './params'
describe('hrefDoFunil', () => {
  it('seta e remove chaves preservando as demais', () => {
    expect(hrefDoFunil('busca=ana&pipeline=p2', { lead: 'l1' })).toBe('/funil?busca=ana&pipeline=p2&lead=l1')
    expect(hrefDoFunil('busca=ana&lead=l1', { lead: null })).toBe('/funil?busca=ana')
    expect(hrefDoFunil('lead=l1', { lead: null })).toBe('/funil')
    expect(hrefDoFunil('', { pipeline: 'p2', lead: 'l1' })).toBe('/funil?pipeline=p2&lead=l1')
  })
})
```
- [ ] **Step 2: Implementar** (`URLSearchParams`, `set`/`delete`, mesma lógica de `hrefDoItem`); `barra-pipelines.tsx` passa a usar `hrefDoFunil(queryAtual, { pipeline: pipeline.isDefault ? null : pipeline.id })`; rodar `barra-pipelines.test.tsx` se existir.

- [ ] **Step 3: `etapa-cor.ts`** — teste pina: `corDaEtapa(0,'aberta')` azul, `(1,'aberta')` amarelo, `(2,'aberta')` laranja, `(3,'aberta')` verde-água, `(4,'aberta')` roxo, `(5,'aberta')` rosa, `(6,'aberta')` = `(0,'aberta')` (cíclico), `(qualquer,'ganho')` verde, `(qualquer,'perdido')` cinza. Implementação com array de objetos literais Tailwind, ex.: `{ fundo: 'bg-sky-200 dark:bg-sky-900/60', texto: 'text-sky-950 dark:text-sky-100' }` — usar as famílias sky/amber/orange/teal/violet/pink; ganho `emerald`; perdido `zinc`. Classes completas, nunca `bg-${cor}-200`.

- [ ] **Step 4: `Drawer`** — teste (jsdom): renderiza `role="dialog"` com `aria-modal="true"` e `aria-labelledby={tituloId}`; foco inicial no botão "Fechar"; Escape chama `aoFechar`; clique no backdrop chama `aoFechar`; clique dentro do painel não chama; ao desmontar, foco volta ao elemento que estava focado antes (render um `<button>` focado antes de montar o Drawer, desmontar, `expect(document.activeElement).toBe(botao)`). Implementação: portal para `document.body` como `Modal` (copiar o padrão `montado`/`createPortal` e o listener de Escape de `modal.tsx:36-52`); painel `fixed inset-y-0 right-0 z-40 flex h-dvh w-[min(560px,100vw)] flex-col bg-background shadow-2xl` com `cabecalho` fixo e `children` em `overflow-y-auto`; backdrop `fixed inset-0 z-30 bg-foreground/30`; `useEffect` guarda `document.activeElement` na montagem e o refoca no cleanup; `useEffect` foca o botão fechar após montar. Rodar e commitar: `feat(ui): Drawer, corDaEtapa e hrefDoFunil`.

---

### Task 4: Drawer do lead no funil + redirect de `/leads/[id]`

**Files:**
- Move (git mv): `src/app/(app)/leads/[id]/{acoes-lead.tsx,acoes.ts,acoes.test.ts,acoes-whatsapp.ts,acoes-whatsapp.test.ts,bloco-scripts.tsx,etiquetas.tsx,etiquetas.test.tsx,nota.tsx,scripts.tsx,scripts.test.tsx,tarefas.tsx,tarefas.test.tsx,timeline.tsx,timeline.test.tsx}` → `src/app/(app)/funil/drawer/`; corrigir imports relativos (`./acoes` etc.) e os absolutos que apontavam para `@/app/(app)/leads/[id]/...` (grep no repo).
- Create: `src/app/(app)/funil/drawer/drawer-lead.tsx` (cliente: cabeçalho + abas + fechar), `src/app/(app)/funil/drawer/cabecalho.tsx` (barra de progresso), `src/app/(app)/funil/drawer/abas.tsx` (tablist), `src/app/(app)/funil/drawer/carregar.ts` (servidor: função que busca tudo que o drawer precisa)
- Modify: `src/app/(app)/funil/page.tsx` (ler `params.lead`, chamar `carregarDrawer`, renderizar `<DrawerLead>`; passar `queryAtual` ao `Quadro`)
- Modify: `src/app/(app)/funil/quadro.tsx` (`CartaoArrastavel` recebe `href` = `hrefDoFunil(queryAtual, { lead: lead.id })`; `Quadro` ganha prop `queryAtual: string`)
- Modify: `src/app/(app)/leads/[id]/page.tsx` (vira redirect) e `page.test.tsx` (reescrever: redireciona para `/funil?pipeline=…&lead=…`, pipeline padrão sem `pipeline=`, inexistente → `/funil`)
- Modify: `src/app/(app)/funil/drawer/acoes-lead.tsx` (remover o `<select>` de etapa — a etapa muda pelo cabeçalho na Task 5; manter só responsável)
- Test: `drawer-lead.test.tsx`, `abas.test.tsx`, `cabecalho.test.tsx`; `tests/e2e/funil.spec.ts` e `tests/e2e/tarefas.spec.ts` (ajustar: clicar no card abre o drawer — `getByRole('dialog')` com heading do nome; "Linha do tempo" agora está na aba Histórico: clicar `getByRole('tab', { name: 'Histórico' })` antes de ler a lista; a URL contém `lead=`; `page.goBack()` fecha o drawer)

**Interfaces:**
- Consumes: `Drawer`, `hrefDoFunil`, `corDaEtapa` (Task 3); `Timeline` com `nomePipeline` (Task 2); `Cartao` com `href` (Task 1).
- Produces:
  ```ts
  // carregar.ts (servidor)
  export type DadosDoDrawer = {
    lead: Lead; pipelines: { pipeline: Pipeline; etapas: Etapa[] }[]; membros: Membro[]; motivos: MotivoPerda[];
    etiquetasConhecidas: Etiqueta[]; tarefas: Tarefa[]; eventos: EventoLead[]; temMaisEventos: boolean; papel: Papel
  }
  export async function carregarDrawer(store: CrmStore, papel: Papel, leadId: string): Promise<Resultado<DadosDoDrawer | null>> // null = lead inexistente/invisivel
  // drawer-lead.tsx (cliente)
  export function DrawerLead({ dados, hrefFechar, blocoScripts }: { dados: DadosDoDrawer; hrefFechar: string; blocoScripts: ReactNode })
  ```
  `blocoScripts` é o `<Suspense><BlocoScripts …/></Suspense>` montado no servidor pela page (server component dentro de client component via children — o padrão que a ficha já usa com Suspense).

- [ ] **Step 1: Mover arquivos** (`git mv`), corrigir imports, `npm run typecheck` verde, commit `refactor: componentes da ficha movem para funil/drawer`.

- [ ] **Step 2: `carregar.ts`** — transplantar o `Promise.all` de `leads/[id]/page.tsx:60-85` (buscarLead, membros, eventosDoLead(LIMITE_EVENTOS+1), etiquetasDaConta, motivosPerda, tarefas) mais `listarPipelines()` seguido de `Promise.all(pipelines.map(p => store.pipelinePorId(p.id)))`. `LIMITE_EVENTOS = 60` vem junto. Lead `null` → `ok(null)`. Teste com `MemoryStore`: devolve todas as pipelines com etapas; lead inexistente → `ok(null)`.

- [ ] **Step 3: `abas.tsx`** — `Abas({ abas: { id: string; rotulo: string; conteudo: ReactNode }[] })` com `role="tablist"`, `role="tab"` `aria-selected`, `role="tabpanel"` `aria-labelledby`; teclado: ArrowLeft/ArrowRight movem seleção e foco (`roving tabindex`). Teste: clique e setas trocam o painel visível; só um `tabpanel` no DOM por vez.

- [ ] **Step 4: `cabecalho.tsx`** — `CabecalhoLead({ lead, pipeline, etapas, gatilhoEtapa }: { lead: Lead; pipeline: Pipeline; etapas: Etapa[]; gatilhoEtapa: ReactNode })`: fundo `bg-primary text-primary-foreground`; linha 1 nome (`<h2 id={tituloId}>`) + valor (`formatarMoeda`); linha 2 etiquetas (`Selo`) + `EditorEtiquetas` compacto (botão "+" que revela o editor); linha 3 nome da pipeline (muted) + `gatilhoEtapa` (na Task 4 é um `<span>` com "Etapa · há N dias"; a Task 5 troca pelo botão do seletor); linha 4 barra: `etapas.filter(e => e.tipo === 'aberta')` na `ordem`, cada faixa `h-1.5 flex-1 rounded-full ${corDaEtapa(e.ordem,'aberta').fundo}` com `opacity-30` nas etapas após a atual; `aria-label="Etapa N de M: <nome>"`. Teste: com 4 abertas e lead na 2ª, as duas primeiras faixas sem `opacity-30`, as duas últimas com; etapa `ganho` não vira faixa.

- [ ] **Step 5: `drawer-lead.tsx`** — usa `Drawer` com `aoFechar={() => router.push(hrefFechar, { scroll: false })}`, `cabecalho={<CabecalhoLead …/>}`, corpo `Abas` com: Principal (`<dl>` Responsável via `AcoesLead` sem etapa / Venda / Telefone com `tel:` / Email / Empresa / Origem + `blocoScripts`), Tarefas (`PainelTarefas`), Histórico (`FormularioNota` + `Timeline` + aviso `temMaisEventos`). Teste: renderiza dialog com o nome, 3 abas, Principal ativa mostra telefone; clicar Histórico mostra "Nada aconteceu ainda." (eventos vazios).

- [ ] **Step 6: `page.tsx` do funil** — `const leadParam = params.lead`; no `Promise.all` existente acrescentar `leadParam ? carregarDrawer(store, papel, leadParam) : Promise.resolve(ok(null))`; após o return do JSX do quadro, `{drawer.ok && drawer.valor && <DrawerLead dados={drawer.valor} hrefFechar={hrefDoFunil(queryAtual, { lead: null })} blocoScripts={<Suspense …><BlocoScripts …/></Suspense>} />}`; `drawer.valor === null` com `leadParam` → renderizar aviso `nao_encontrado` do `erros.ts` acima do quadro (sem 404). `queryAtual` deve ser calculado **sem** a chave `lead` para a `key` do `Quadro` (senão abrir o drawer remonta o quadro e perde as páginas extras): `const queryDoQuadro = hrefDoFunil(queryAtual, { lead: null })` → usar só a parte da query na `key`. Passar `queryAtual` ao `Quadro`.

- [ ] **Step 7: `/leads/[id]/page.tsx`** vira:
```tsx
import { redirect } from 'next/navigation'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import { hrefDoFunil } from '@/app/(app)/funil/params'
/** A ficha virou o drawer do funil (spec 2026-08-28). Links antigos (sino, tarefas, timeline) continuam validos por este redirect. */
export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const contexto = await criarStoreDoServidor()
  if (!contexto.ok) redirect('/login')
  const lead = await contexto.valor.store.buscarLead(id)
  if (!lead.ok || !lead.valor) redirect('/funil')
  const pipeline = await contexto.valor.store.pipelinePorId(lead.valor.pipelineId)
  const pipelineParam = pipeline.ok && !pipeline.valor.pipeline.isDefault ? lead.valor.pipelineId : null
  redirect(hrefDoFunil('', { pipeline: pipelineParam, lead: id }))
}
```
Reescrever `page.test.tsx` (3 casos: padrão, não-padrão, inexistente; `redirect` do Next lança — usar o mesmo mock/padrão que o teste atual já usa).

- [ ] **Step 8: E2E** — ajustar `funil.spec.ts` (o trecho após "Perdido": clicar no link, `expect(page).toHaveURL(/lead=/)`, `getByRole('dialog')`, clicar aba Histórico, ler `ol > li > p:first-child` dentro do dialog; "Perdido" e "R$ 1.500,00" dentro do dialog; `page.goBack()` → dialog some) e `tarefas.spec.ts` (o que abria `/leads/<id>` agora espera o drawer). Rodar `npm test && npm run typecheck && npm run lint`, `npm run test:integration`, `npm run db:reset`, `npm run test:e2e`. Commit `feat(funil): drawer do lead por ?lead= com abas; /leads/[id] redireciona`.

---

### Task 5: Seletor de pipeline/etapa no cabeçalho

**Files:**
- Create: `src/app/(app)/funil/drawer/seletor-etapa.tsx` + `seletor-etapa.test.tsx`
- Modify: `src/app/(app)/funil/drawer/drawer-lead.tsx` (passa o seletor como `gatilhoEtapa` do cabeçalho; após mover para outra pipeline, `router.push(hrefDoFunil(queryAtual, { pipeline: novaPipelineIsDefault ? null : novaId, lead: lead.id }), { scroll: false })`)
- Test: `tests/e2e/funil.spec.ts` (novo caso: criar segunda pipeline pela UI, abrir drawer, mover pelo seletor, ver o card na pipeline nova)

**Interfaces:**
- Consumes: `moverEtapaAction`, `moverParaPipelineAction` (Task 2), `ModalMovimento` (`funil/modal-movimento.tsx`, `PedidoMovimento = { leadId, nomeLead, destino: Etapa }`), `corDaEtapa`.
- Produces:
  ```ts
  export function SeletorEtapa({ lead, pipelines, motivos, etiquetasConhecidas, aoMover }: {
    lead: Lead; pipelines: { pipeline: Pipeline; etapas: Etapa[] }[]; motivos: MotivoPerda[]; etiquetasConhecidas: Etiqueta[];
    aoMover: (destino: { pipelineId: string; stageId: string }) => void  // chamado depois do sucesso
  })
  ```

- [ ] **Step 1: Teste** (jsdom; `vi.mock('./../acoes')` só para as duas actions — não há store injetável em componente cliente; afirmar QUAL action foi chamada e com quais ids):
  - abre com o botão "<nome da etapa> · há N dias"; lista a pipeline atual expandida com todas as etapas (abertas na ordem, depois ganho/perdido) e ✓ na atual; outras pipelines aparecem só como cabeçalho;
  - clicar num cabeçalho de outra pipeline expande as etapas dela;
  - escolher etapa da pipeline atual abre `ModalMovimento` (heading "<nome> → <etapa>"); confirmar chama `moverEtapaAction(lead.id, stageId, null, [])` e depois `aoMover({ pipelineId: atual, stageId })`;
  - escolher etapa de OUTRA pipeline: confirmar chama `moverParaPipelineAction(lead.id, stageId, null, [])` e `aoMover({ pipelineId: outra, stageId })`;
  - escolher a etapa atual: fecha, nenhuma action chamada;
  - action falha → mensagem via `mensagemDeErro` (ex.: `mesma_pipeline`), `aoMover` não chamado.

- [ ] **Step 2: Implementar** — popover ancorado (`absolute` sob o botão, `role="listbox"`, grupos com `role="group"` `aria-label={pipeline.nome}`, opções `role="option"` `aria-selected`), fechamento por Escape/clique fora; estado `expandida: string` (id da pipeline expandida, inicial = a do lead); cada opção com `corDaEtapa(e.ordem, e.tipo).fundo/texto`; ✓ (`Check` do lucide) na atual. Ao escolher: `setPedido({ leadId, nomeLead, destino })` + guarda `pipelineDestinoId`; `confirmar` decide a action por `destino.pipelineId === lead.pipelineId`.

- [ ] **Step 3: Ligar no drawer** — `drawer-lead.tsx` passa `<SeletorEtapa … aoMover={(d) => router.push(hrefDoFunil(queryAtual, { pipeline: …, lead: lead.id }), { scroll: false })} />` como `gatilhoEtapa`; `queryAtual` chega como prop do page. Após mover na mesma pipeline, `router.refresh()` basta (o quadro e o cabeçalho re-renderizam).

- [ ] **Step 4: E2E** — em `funil.spec.ts`: criar pipeline "Pós-venda" pelo botão "+ Nova pipeline" (ver `pipelines.spec.ts` para o fluxo), voltar à padrão, criar lead, abrir o drawer, clicar no gatilho da etapa, expandir "Pós-venda", escolher a primeira etapa, confirmar; esperar URL com `pipeline=` da nova e o card visível na coluna dela; aba Histórico mostra "Movido de …".

- [ ] **Step 5: Verificar tudo** (`npm test`, typecheck, lint, integração, `db:reset`, e2e) e commitar `feat(funil): seletor de pipeline/etapa no drawer, mover entre pipelines`.
