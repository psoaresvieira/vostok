# Plano 16 — Conexão do Meta pelo operador

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um script de linha de comando com que o dono da plataforma conecta uma Page do Meta ao tenant de um cliente, usando token de System User — o caller que a migration `0030` deixou sem existir.

**Architecture:** A orquestração (listar → posse → assinar → gravar → compensar) vira função pura de dependências em `src/lib/integracoes/conectar-pagina-operador.ts`, testada com `MetaGraphFalso` e um `gravar` falso. O script `scripts/conectar-meta-operador.ts` só lê argumentos e env, autentica o dono no Supabase de produção e injeta `MetaGraphReal` + a RPC. A Server Action da UI **não** muda.

**Tech Stack:** TypeScript, vitest (unitário), `@supabase/supabase-js` (client anon + `signInWithPassword`), `tsx` (executor com resolução do alias `@/`), `dotenv`, `node:util` `parseArgs`.

Spec: `docs/superpowers/specs/2026-08-28-crm-conexao-meta-operador-design.md`.

## Global Constraints

- Nenhum teste automatizado toca a rede (constraint da spec de ingestão): o Graph real só é chamado pelo script em execução manual.
- Ordem posse → assinar → gravar; compensação com `desassinarLeadgen` **somente** quando a assinatura foi desta chamada (não é reivindicação **e** o erro não é `page_ja_conectada`). Mesma regra de `src/app/(app)/config/acoes-fontes.ts:100-160`.
- Falhar fechado antes de tocar o Graph se `INGESTAO_SEGREDO` (ou qualquer env obrigatória) estiver vazio.
- Identificadores sem acento, comentários em português, como o resto do repo.
- Branch de trabalho: `plano-16-meta-operador` a partir de `master`. Commits pequenos.
- Suíte: `npm test`, `npm run typecheck`, `npm run lint` verdes ao fim de cada task.

---

### Task 1: Orquestração pura `conectarPaginaComoOperador`

**Files:**
- Create: `src/lib/integracoes/conectar-pagina-operador.ts`
- Test: `src/lib/integracoes/conectar-pagina-operador.test.ts`

**Interfaces:**
- Consumes: `MetaGraph`, `PaginaDoMeta` de `./meta`; `Resultado`, `ok`, `falha` de `@/lib/domain/resultado`; `MetaGraphFalso` de `./meta-falso` (só no teste; construtor aceita a lista de Pages, `falharEm: keyof MetaGraph`, arrays `listadas`/`posseConferida`/`assinadas`/`desassinadas`).
- Produces:
  ```ts
  export type GravarFonte = (pagina: PaginaDoMeta) => Promise<Resultado<string>>
  export type EntradaOperador = {
    graph: MetaGraph
    gravar: GravarFonte
    pageId: string
    tokenDoUsuario: string
    reivindicar: boolean
  }
  export function conectarPaginaComoOperador(e: EntradaOperador): Promise<Resultado<string>>
  ```
  Devolve `ok(sourceId)` ou `falha(codigo)` com `pagina_nao_encontrada`, `posse_nao_comprovada`, `meta_indisponivel`, ou o erro de `gravar` repassado.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// src/lib/integracoes/conectar-pagina-operador.test.ts
import { describe, expect, it } from 'vitest'
import { ok, falha } from '@/lib/domain/resultado'
import { MetaGraphFalso } from './meta-falso'
import { conectarPaginaComoOperador, type GravarFonte } from './conectar-pagina-operador'

const PAGE = '100000000000001'
const gravaOk: GravarFonte = async () => ok('source-1')

function entrada(graph: MetaGraphFalso, gravar: GravarFonte, reivindicar = false) {
  return { graph, gravar, pageId: PAGE, tokenDoUsuario: 'token-system-user', reivindicar }
}

describe('conectarPaginaComoOperador', () => {
  it('lista com o token recebido, prova posse, assina e grava, nessa ordem', async () => {
    const graph = new MetaGraphFalso()
    const recebidas: string[] = []
    const gravar: GravarFonte = async (p) => {
      // Se assinar viesse depois de gravar, `assinadas` estaria vazio aqui.
      recebidas.push(`${p.id}|${p.token}|assinadas=${graph.assinadas.length}`)
      return ok('source-1')
    }
    const r = await conectarPaginaComoOperador(entrada(graph, gravar))
    expect(r).toEqual(ok('source-1'))
    expect(graph.listadas).toEqual(['token-system-user'])
    expect(graph.posseConferida).toEqual([PAGE])
    expect(graph.assinadas).toEqual([PAGE])
    // Token da Page vem da listagem, nunca do chamador.
    expect(recebidas).toEqual([`${PAGE}|token-da-pagina-1|assinadas=1`])
  })

  it('Page ausente da listagem: pagina_nao_encontrada, sem tocar posse nem assinar', async () => {
    const graph = new MetaGraphFalso([])
    const r = await conectarPaginaComoOperador(entrada(graph, gravaOk))
    expect(r).toEqual(falha('pagina_nao_encontrada'))
    expect(graph.posseConferida).toEqual([])
    expect(graph.assinadas).toEqual([])
  })

  it('posse recusada: repassa o erro e nao assina', async () => {
    const graph = new MetaGraphFalso()
    graph.falharEm = 'posseDaPagina'
    const r = await conectarPaginaComoOperador(entrada(graph, gravaOk))
    expect(r).toEqual(falha('meta_indisponivel'))
    expect(graph.assinadas).toEqual([])
  })

  it('gravar falha numa conexao: compensa desassinando', async () => {
    const graph = new MetaGraphFalso()
    const r = await conectarPaginaComoOperador(entrada(graph, async () => falha('sem_permissao')))
    expect(r).toEqual(falha('sem_permissao'))
    expect(graph.desassinadas).toEqual([PAGE])
  })

  it('gravar falha com page_ja_conectada: NAO desassina (a inscricao e do outro tenant)', async () => {
    const graph = new MetaGraphFalso()
    const r = await conectarPaginaComoOperador(entrada(graph, async () => falha('page_ja_conectada')))
    expect(r).toEqual(falha('page_ja_conectada'))
    expect(graph.desassinadas).toEqual([])
  })

  it('gravar falha numa reivindicacao: NAO desassina (a Page ja estava inscrita)', async () => {
    const graph = new MetaGraphFalso()
    const r = await conectarPaginaComoOperador(entrada(graph, async () => falha('sem_permissao'), true))
    expect(r).toEqual(falha('sem_permissao'))
    expect(graph.desassinadas).toEqual([])
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/integracoes/conectar-pagina-operador.test.ts`
Expected: FAIL — `Failed to resolve import "./conectar-pagina-operador"`.

- [ ] **Step 3: Implementar**

```ts
// src/lib/integracoes/conectar-pagina-operador.ts
import { falha, ok, type Resultado } from '@/lib/domain/resultado'
import type { MetaGraph, PaginaDoMeta } from './meta'

export type GravarFonte = (pagina: PaginaDoMeta) => Promise<Resultado<string>>

export type EntradaOperador = {
  graph: MetaGraph
  gravar: GravarFonte
  pageId: string
  /** Token de System User (ou de usuario) que administra a Page. */
  tokenDoUsuario: string
  /** true usa a gravacao que toma a Page de outra conta (reivindicar_fonte_meta). */
  reivindicar: boolean
}

/**
 * Orquestracao do modo operador (0030): o dono da plataforma conecta uma
 * Page ao tenant de um cliente. E a MESMA sequencia de
 * `conectarOuReivindicar` em app/(app)/config/acoes-fontes.ts, duplicada de
 * proposito — a action e amarrada a cookie e a conta ativa da sessao, e o
 * dono nao e membro da conta do cliente (0028). Se a regra mudar la, muda
 * aqui; o teste desta funcao pina a regra.
 */
export async function conectarPaginaComoOperador(e: EntradaOperador): Promise<Resultado<string>> {
  // Buscar a Page pela listagem, nunca confiar num token de Page vindo de
  // fora: o token da Page e o que vai para source_credentials.
  const paginas = await e.graph.listarPaginas(e.tokenDoUsuario)
  if (!paginas.ok) return falha(paginas.erro)
  const pagina = paginas.valor.find((p) => p.id === e.pageId)
  if (!pagina) return falha('pagina_nao_encontrada')

  // Posse ANTES de qualquer escrita ou assinatura (Task 10 do Plano 4).
  const posse = await e.graph.posseDaPagina(pagina.id, pagina.token)
  if (!posse.ok) return falha(posse.erro)

  // Assinar ANTES de gravar: fonte gravada sem inscricao nunca recebe webhook.
  const assinou = await e.graph.assinarLeadgen(pagina.id, pagina.token)
  if (!assinou.ok) return falha(assinou.erro)

  const r = await e.gravar(pagina)
  if (!r.ok) {
    // So desfaz a assinatura que ESTA chamada criou. `assinarLeadgen` e
    // idempotente no Meta: numa reivindicacao a Page ja estava inscrita, e
    // `page_ja_conectada` e prova de que pertencia a outra conta. Desassinar
    // nesses casos derrubaria a inscricao de que o outro tenant depende.
    const assinaturaEraDestaChamada = !e.reivindicar && r.erro !== 'page_ja_conectada'
    if (assinaturaEraDestaChamada) {
      await e.graph.desassinarLeadgen(pagina.id, pagina.token)
    }
    return falha(r.erro)
  }
  return ok(r.valor)
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/integracoes/conectar-pagina-operador.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Mutação de propósito (não commitar)**

Troque `!e.reivindicar && r.erro !== 'page_ja_conectada'` por `true`; rode de novo. Expected: os dois testes "NAO desassina" falham. Reverta.

- [ ] **Step 6: Commit**

```bash
git add src/lib/integracoes/conectar-pagina-operador.ts src/lib/integracoes/conectar-pagina-operador.test.ts
git commit -m "feat: orquestracao da conexao de Page pelo operador (0030)"
```

---

### Task 2: Script `scripts/conectar-meta-operador.ts` + runbook

**Files:**
- Create: `scripts/conectar-meta-operador.ts`
- Create: `src/lib/integracoes/argumentos-operador.ts`
- Test: `src/lib/integracoes/argumentos-operador.test.ts`
- Modify: `src/lib/data/fontes.ts:114` (exportar `codigo`)
- Modify: `package.json` (devDependency `tsx`, script `meta:conectar`)
- Modify: `README.md` (nova seção após "Onboarding beta do Meta (operador)")

**Interfaces:**
- Consumes: `conectarPaginaComoOperador` (Task 1); `MetaGraphReal` de `@/lib/integracoes/meta-real` (construtor sem argumentos); `codigo(erro: {message, code})` de `@/lib/data/fontes`; `mensagemDeErro` de `@/app/(app)/config/erros`.
- Produces:
  ```ts
  export type ArgumentosOperador = { conta: string; page: string; responsavel: string | null; reivindicar: boolean; env: string }
  export function lerArgumentos(argv: string[]): Resultado<ArgumentosOperador>
  export type EnvsOperador = { url: string; anonKey: string; segredo: string; email: string; senha: string; tokenMeta: string }
  export function envsObrigatorias(env: NodeJS.ProcessEnv): Resultado<EnvsOperador>
  ```

- [ ] **Step 1: Testes de parsing e de env**

```ts
// src/lib/integracoes/argumentos-operador.test.ts
import { describe, expect, it } from 'vitest'
import { ok, falha } from '@/lib/domain/resultado'
import { envsObrigatorias, lerArgumentos } from './argumentos-operador'

const CONTA = '11111111-1111-4111-8111-111111111111'
const USER = '22222222-2222-4222-8222-222222222222'

describe('lerArgumentos', () => {
  it('le conta, page, env e defaults', () => {
    expect(lerArgumentos(['--conta', CONTA, '--page', '123', '--env', 'prod.env'])).toEqual(
      ok({ conta: CONTA, page: '123', responsavel: null, reivindicar: false, env: 'prod.env' }),
    )
  })
  it('aceita responsavel e reivindicar', () => {
    const r = lerArgumentos(['--conta', CONTA, '--page', '123', '--env', 'e', '--responsavel', USER, '--reivindicar'])
    expect(r).toEqual(ok({ conta: CONTA, page: '123', responsavel: USER, reivindicar: true, env: 'e' }))
  })
  it('recusa conta que nao e uuid, page vazia, responsavel invalido e env ausente', () => {
    expect(lerArgumentos(['--conta', 'abc', '--page', '123', '--env', 'e'])).toEqual(falha('conta_invalida'))
    expect(lerArgumentos(['--conta', CONTA, '--page', ' ', '--env', 'e'])).toEqual(falha('page_invalida'))
    expect(lerArgumentos(['--conta', CONTA, '--page', '1', '--env', 'e', '--responsavel', 'x'])).toEqual(falha('responsavel_invalido'))
    expect(lerArgumentos(['--page', '1', '--env', 'e'])).toEqual(falha('conta_invalida'))
    expect(lerArgumentos(['--conta', CONTA, '--page', '1'])).toEqual(falha('env_invalido'))
  })
})

describe('envsObrigatorias', () => {
  const cheio = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
    INGESTAO_SEGREDO: 'seg',
    OPERADOR_EMAIL: 'dono@x',
    OPERADOR_SENHA: 's',
    META_TOKEN_SYSTEM_USER: 'tok',
  }
  it('devolve o conjunto quando tudo esta presente', () => {
    expect(envsObrigatorias(cheio)).toEqual(
      ok({ url: 'https://x.supabase.co', anonKey: 'anon', segredo: 'seg', email: 'dono@x', senha: 's', tokenMeta: 'tok' }),
    )
  })
  it('falha fechado nomeando a env vazia', () => {
    expect(envsObrigatorias({ ...cheio, INGESTAO_SEGREDO: '' })).toEqual(falha('env_ausente:INGESTAO_SEGREDO'))
    expect(envsObrigatorias({ ...cheio, META_TOKEN_SYSTEM_USER: undefined })).toEqual(falha('env_ausente:META_TOKEN_SYSTEM_USER'))
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/integracoes/argumentos-operador.test.ts`
Expected: FAIL — import não resolvido.

- [ ] **Step 3: Implementar `argumentos-operador.ts`**

```ts
// src/lib/integracoes/argumentos-operador.ts
import { parseArgs } from 'node:util'
import { falha, ok, type Resultado } from '@/lib/domain/resultado'

export type ArgumentosOperador = {
  conta: string
  page: string
  responsavel: string | null
  reivindicar: boolean
  env: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function lerArgumentos(argv: string[]): Resultado<ArgumentosOperador> {
  const { values } = parseArgs({
    args: argv,
    options: {
      conta: { type: 'string' },
      page: { type: 'string' },
      responsavel: { type: 'string' },
      env: { type: 'string' },
      reivindicar: { type: 'boolean', default: false },
    },
    strict: true,
  })
  if (!values.conta || !UUID.test(values.conta)) return falha('conta_invalida')
  if (!values.page || values.page.trim().length === 0) return falha('page_invalida')
  if (values.responsavel !== undefined && !UUID.test(values.responsavel)) return falha('responsavel_invalido')
  if (!values.env) return falha('env_invalido')
  return ok({
    conta: values.conta,
    page: values.page.trim(),
    responsavel: values.responsavel ?? null,
    reivindicar: values.reivindicar ?? false,
    env: values.env,
  })
}

export type EnvsOperador = {
  url: string
  anonKey: string
  segredo: string
  email: string
  senha: string
  tokenMeta: string
}

const MAPA: [keyof EnvsOperador, string][] = [
  ['url', 'NEXT_PUBLIC_SUPABASE_URL'],
  ['anonKey', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'],
  ['segredo', 'INGESTAO_SEGREDO'],
  ['email', 'OPERADOR_EMAIL'],
  ['senha', 'OPERADOR_SENHA'],
  ['tokenMeta', 'META_TOKEN_SYSTEM_USER'],
]

/**
 * Falha fechado ANTES de tocar o Graph: sem INGESTAO_SEGREDO a RPC recusaria
 * depois de `assinarLeadgen` ja ter rodado, e a compensacao deixaria rastro
 * de assinar/desassinar numa Page de terceiro (mesma razao da guarda
 * `ingestao_nao_configurada` da action).
 */
export function envsObrigatorias(env: NodeJS.ProcessEnv): Resultado<EnvsOperador> {
  const saida = {} as EnvsOperador
  for (const [chave, nome] of MAPA) {
    const v = env[nome]
    if (!v || v.length === 0) return falha(`env_ausente:${nome}`)
    saida[chave] = v
  }
  return ok(saida)
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/integracoes/argumentos-operador.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Exportar `codigo` em `fontes.ts`**

Em `src/lib/data/fontes.ts:114`, `function codigo(` → `export function codigo(`. Nada mais muda.

- [ ] **Step 6: Instalar `tsx` e registrar o script**

Run: `npm i -D tsx`
Em `package.json`, dentro de `"scripts"`, após `"db:reset"`:

```json
"meta:conectar": "tsx --tsconfig tsconfig.json scripts/conectar-meta-operador.ts"
```

- [ ] **Step 7: Escrever o script**

```ts
// scripts/conectar-meta-operador.ts
/**
 * Modo operador (0030): conecta uma Page do Meta ao tenant de um cliente,
 * com token de System User do BM da Vostok. Uso:
 *
 *   npm run meta:conectar -- --env prod.env --conta <account_id> --page <page_id> [--responsavel <user_id>] [--reivindicar]
 *
 * `prod.env` = `vercel env pull prod.env --environment=production` mais
 * OPERADOR_EMAIL, OPERADOR_SENHA e META_TOKEN_SYSTEM_USER. Nunca commitar
 * (.gitignore ja cobre `.env*`; use nome terminado em .env).
 *
 * META_API_VERSION e lida na CARGA de meta-real.ts, antes do dotenv abaixo:
 * o script usa o default do modulo (v21.0, o mesmo da Vercel). Para outra
 * versao, exporte a variavel no shell.
 */
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { mensagemDeErro } from '@/app/(app)/config/erros'
import { codigo } from '@/lib/data/fontes'
import { envsObrigatorias, lerArgumentos } from '@/lib/integracoes/argumentos-operador'
import { conectarPaginaComoOperador } from '@/lib/integracoes/conectar-pagina-operador'
import { MetaGraphReal } from '@/lib/integracoes/meta-real'

function sair(erro: string): never {
  console.error(`erro: ${mensagemDeErro(erro)} (${erro})`)
  process.exit(1)
}

async function main() {
  const args = lerArgumentos(process.argv.slice(2))
  if (!args.ok) sair(args.erro)
  const a = args.valor

  config({ path: a.env, override: true })
  const envs = envsObrigatorias(process.env)
  if (!envs.ok) sair(envs.erro)
  const e = envs.valor

  const supabase = createClient(e.url, e.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const login = await supabase.auth.signInWithPassword({ email: e.email, password: e.senha })
  if (login.error) sair('credenciais_invalidas')

  const rpc = a.reivindicar ? 'reivindicar_fonte_meta' : 'conectar_fonte_meta'
  const r = await conectarPaginaComoOperador({
    graph: new MetaGraphReal(),
    pageId: a.page,
    tokenDoUsuario: e.tokenMeta,
    reivindicar: a.reivindicar,
    gravar: async (pagina) => {
      const { data, error } = await supabase.rpc(rpc, {
        p_segredo: e.segredo,
        p_account_id: a.conta,
        p_page_id: pagina.id,
        p_nome: pagina.nome,
        p_token: pagina.token,
        p_responsavel: a.responsavel,
      })
      if (error) return { ok: false as const, erro: codigo(error) }
      return { ok: true as const, valor: data as string }
    },
  })
  await supabase.auth.signOut()
  if (!r.ok) sair(r.erro)
  console.log(`conectada: source_id=${r.valor} page=${a.page} conta=${a.conta}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 8: README — seção "Conectar Page de cliente (modo operador)"**

Inserir após a seção "Onboarding beta do Meta (operador)", antes de "Getting Started". Texto (as cercas internas de código usam quatro crases no README para não fechar a seção):

> ## Conectar Page de cliente (modo operador)
>
> A implantação de cliente é manual do dono da plataforma (migration `0030`). O script abaixo conecta uma Page ao tenant do cliente com token de **System User** — sem OAuth pelo navegador.
>
> Pré-condições, nesta ordem:
>
> 1. **App do Meta** dentro do BM da Vostok, com Webhooks → Page → `leadgen` apontando para `https://vostok-beta.vercel.app/api/webhooks/meta` e verificado com o `META_VERIFY_TOKEN` da Vercel. Conferir com `GET /{app-id}/subscriptions?access_token={app-id}|{app-secret}`.
> 2. **System User** no BM da Vostok com a Page do cliente **atribuída** e token permanente com `pages_show_list`, `pages_manage_metadata`, `leads_retrieval`, gerado para esse app.
> 3. O cliente **aceitou o convite** e é membro do tenant (senão `responsavel_invalido` ao passar `--responsavel`).
>
> Execução:
>
> `vercel env pull prod.env --environment=production --yes`
> acrescente ao `prod.env`: `OPERADOR_EMAIL`, `OPERADOR_SENHA` (login do dono), `META_TOKEN_SYSTEM_USER`
> `npm run meta:conectar -- --env prod.env --conta <account_id> --page <page_id> [--responsavel <user_id>] [--reivindicar]`
>
> `META_API_VERSION` é lida na carga do módulo do Graph, antes do arquivo de env: exporte-a no shell se precisar de versão diferente de `v21.0`. Segunda execução para a mesma Page devolve `page_ja_conectada` e para — tomar a Page de outra conta é ato explícito (`--reivindicar`). Apague `prod.env` ao terminar.
>
> Prova ponta a ponta: Lead Ads Testing Tool (`developers.facebook.com/tools/lead-ads-testing`) na Page → lead no `/funil` do cliente com campanha/conjunto/anúncio; reenvio do mesmo lead não duplica.

- [ ] **Step 9: Verificar suíte, tipos e lint; exercitar o script sem rede**

Run: `npm test && npm run typecheck && npm run lint`
Expected: tudo verde (o `tsconfig.json` inclui `**/*.ts`, então `scripts/` entra no typecheck).

Run: `npm run meta:conectar -- --env nao-existe.env --conta 11111111-1111-4111-8111-111111111111 --page 1`
Expected: `erro: env_ausente:NEXT_PUBLIC_SUPABASE_URL (env_ausente:NEXT_PUBLIC_SUPABASE_URL)`, exit 1 — falha fechado antes de qualquer rede.

- [ ] **Step 10: Commit**

```bash
git add scripts/conectar-meta-operador.ts src/lib/integracoes/argumentos-operador.ts src/lib/integracoes/argumentos-operador.test.ts src/lib/data/fontes.ts package.json package-lock.json README.md
git commit -m "feat: script de operador para conectar Page do Meta ao tenant do cliente"
```

---

### Task 3: Implantação real (manual, com o Pedro)

Sem código. Executar na ordem, registrando o resultado de cada item em `progresso.md` do Obsidian.

- [ ] **1.** App novo no BM da Vostok (tipo Business) → App ID/Secret.
- [ ] **2.** Webhooks → Page → `leadgen`, URL `https://vostok-beta.vercel.app/api/webhooks/meta`, verify token de `openssl rand -hex 32`.
- [ ] **3.** Login do Facebook → URI de redirecionamento `https://vostok-beta.vercel.app/api/integracoes/meta/retorno`.
- [ ] **4.** System User no BM com a Page atribuída; token permanente (`pages_show_list`, `pages_manage_metadata`, `leads_retrieval`).
- [ ] **5.** Vercel: `vercel env rm META_APP_ID production` / `vercel env add META_APP_ID production` (idem `META_APP_SECRET`, `META_VERIFY_TOKEN`) → redeploy (push de `master` ou `vercel --prod`).
- [ ] **6.** Verificar o webhook no painel (o GET de prod ecoa o challenge); conferir por `GET /{app-id}/subscriptions`.
- [ ] **7.** Merge de `plano-16-meta-operador` em `master`.
- [ ] **8.** Rodar `npm run meta:conectar` com o `account_id` do cliente (em `/admin`) e o `page_id`. Guardar o `source_id`.
- [ ] **9.** Lead Ads Testing Tool → lead no `/funil` do cliente; reenvio não duplica; `integration_log` sem pendência.
- [ ] **10.** Apagar `prod.env`; anotar no Obsidian que `posseDaPagina` foi provado contra o Graph real (era o único pendente que sustentava afirmação de segurança).
