import { describe, it, expect, beforeEach } from 'vitest'
import { SupabaseScriptStore } from '@/lib/data/scripts'
import { comoServico, limparBanco } from './helpers/db'
import { clienteDoUsuario } from './helpers/cliente'
import { montarCenario, etapa, type Cenario } from './helpers/cenario'

/**
 * Segunda conta com admin, pipeline e uma etapa proprios — mesmo helper de
 * 0020_scripts.test.ts (o repo replica esse molde por arquivo em vez de
 * compartilha-lo: 0008, 0018, 0020). Aqui ele serve a tres casos: etapa alheia
 * no `criar`, `buscar` cross-tenant e vazamento de tag em `tagsDaConta`.
 */
async function segundaContaComEtapa(
  nome: string,
  email: string,
): Promise<{ accountId: string; adminId: string; stageId: string }> {
  return comoServico(async (cli) => {
    const u = await cli.query<{ id: string }>(
      `insert into auth.users (id, aud, role, email)
       values (gen_random_uuid(), 'authenticated', 'authenticated', $1) returning id`,
      [email],
    )
    await cli.query(
      `insert into public.profiles (id, nome, email) values ($1, 'Admin B', $2)
       on conflict (id) do nothing`,
      [u.rows[0].id, email],
    )
    const a = await cli.query<{ id: string }>(
      `insert into public.accounts (nome) values ($1) returning id`,
      [nome],
    )
    await cli.query(
      `insert into public.memberships (account_id, user_id, papel) values ($1, $2, 'admin')`,
      [a.rows[0].id, u.rows[0].id],
    )
    const p = await cli.query<{ id: string }>(
      `insert into public.pipelines (account_id, nome, is_default) values ($1, 'Funil', true)
       returning id`,
      [a.rows[0].id],
    )
    const s = await cli.query<{ id: string }>(
      `insert into public.stages (pipeline_id, nome, ordem, tipo)
       values ($1, 'Novo lead', 1, 'aberta') returning id`,
      [p.rows[0].id],
    )
    return { accountId: a.rows[0].id, adminId: u.rows[0].id, stageId: s.rows[0].id }
  })
}

/** Membership extra pelo servico: e' o que torna o usuario membro de DUAS
 * contas, condicao para os casos em que a RLS (is_member_of) sozinha deixaria
 * ver a conta errada. */
async function adicionarMembership(accountId: string, userId: string, papel: string) {
  await comoServico((cli) =>
    cli.query(
      `insert into public.memberships (account_id, user_id, papel) values ($1, $2, $3)`,
      [accountId, userId, papel],
    ),
  )
}

/** Insere direto, ignorando RLS e o proprio store: e' o unico jeito de fixar o
 * `id` (desempate) e de semear script em conta onde o usuario sob teste nao
 * escreve. */
async function inserirScript(d: {
  accountId: string
  titulo: string
  conteudo?: string
  stageId?: string | null
  tags?: string[]
  criadoPor?: string | null
  id?: string
}): Promise<string> {
  return comoServico(async (cli) => {
    const r = await cli.query<{ id: string }>(
      `insert into public.scripts (id, account_id, titulo, conteudo, stage_id, tags, criado_por)
       values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7) returning id`,
      [
        d.id ?? null,
        d.accountId,
        d.titulo,
        d.conteudo ?? 'conteudo',
        d.stageId ?? null,
        d.tags ?? [],
        d.criadoPor ?? null,
      ],
    )
    return r.rows[0].id
  })
}

async function lerScript(id: string) {
  return comoServico(async (cli) => {
    const r = await cli.query(
      `select id, account_id, titulo, conteudo, stage_id, tags, criado_por, atualizado_em
         from public.scripts where id = $1`,
      [id],
    )
    return r.rows[0] as
      | {
          id: string
          account_id: string
          titulo: string
          conteudo: string
          stage_id: string | null
          tags: string[]
          criado_por: string | null
          atualizado_em: string
        }
      | undefined
  })
}

describe('SupabaseScriptStore', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  async function storeDe(usuarioId: string, contaId?: string) {
    const cliente = await clienteDoUsuario(usuarioId)
    return new SupabaseScriptStore(cliente, contaId ?? c.accountId, usuarioId)
  }

  it('Caso 1: criar normaliza as tags no banco e listar devolve o mapeamento camelCase', async () => {
    const store = await storeDe(c.gestorId)
    const novo = etapa(c, 'Novo lead')

    const criado = await store.criar({
      titulo: 'Abordagem inicial',
      conteudo: 'Ola {{primeiro_nome}}, tudo bem?',
      stageId: novo,
      tags: [' Objeção ', 'OBJEÇÃO', 'preço'],
    })
    if (!criado.ok) throw new Error(criado.erro)

    // Relido PELO SERVICO, nao pelo valor devolvido: a normalizacao tem que
    // ter chegado ao banco. Se o store gravasse as tags cruas e so
    // normalizasse na volta, esta linha ficaria vermelha e a de listar nao.
    const linha = await lerScript(criado.valor)
    expect(linha?.tags).toEqual(['objeção', 'preço'])
    expect(linha?.criado_por).toBe(c.gestorId)
    expect(linha?.account_id).toBe(c.accountId)

    const r = await store.listar({})
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor).toHaveLength(1)
    expect(r.valor[0]).toMatchObject({
      id: criado.valor,
      titulo: 'Abordagem inicial',
      conteudo: 'Ola {{primeiro_nome}}, tudo bem?',
      stageId: novo,
      tags: ['objeção', 'preço'],
    })
    expect(r.valor[0].criadoEm).toBeInstanceOf(Date)
    expect(r.valor[0].atualizadoEm).toBeInstanceOf(Date)
  })

  it('Caso 2: busca textual trata % como literal, nunca como curinga do LIKE', async () => {
    const store = await storeDe(c.gestorId)

    const comPercent = await store.criar({
      titulo: 'Desconto agressivo',
      conteudo: 'Fecho hoje com Desconto 100% no primeiro mes',
      stageId: null,
      tags: [],
    })
    const semPercent = await store.criar({
      titulo: 'Volume',
      conteudo: 'Pacote de Desconto 100 leads por mes',
      stageId: null,
      tags: [],
    })
    if (!comPercent.ok || !semPercent.ok) throw new Error('setup falhou')

    // Com interpolacao crua o padrao viraria '%100%%' e o segundo `%` seria
    // curinga: os DOIS scripts casariam. Com padraoIlike o `%` digitado e'
    // escapado e so o primeiro casa.
    const r = await store.listar({ busca: '100%' })
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor.map((s) => s.id)).toEqual([comPercent.valor])

    // O ramo do titulo do `.or(...)` tambem precisa estar la: 'Desconto
    // agressivo' nao aparece em nenhum conteudo.
    const porTitulo = await store.listar({ busca: 'Desconto agressivo' })
    if (!porTitulo.ok) throw new Error(porTitulo.erro)
    expect(porTitulo.valor.map((s) => s.id)).toEqual([comPercent.valor])
  })

  it('Caso 3: listar filtra por tag (contains) e por etapa (eq)', async () => {
    const store = await storeDe(c.gestorId)
    const novo = etapa(c, 'Novo lead')
    const contato = etapa(c, 'Contato feito')

    const comDuasTags = await store.criar({
      titulo: 'Primeiro contato',
      conteudo: 'x',
      stageId: novo,
      tags: ['frio', 'whatsapp'],
    })
    const outraTag = await store.criar({
      titulo: 'Retomada',
      conteudo: 'y',
      stageId: contato,
      tags: ['morno'],
    })
    const semNada = await store.criar({
      titulo: 'Generico',
      conteudo: 'z',
      stageId: null,
      tags: [],
    })
    if (!comDuasTags.ok || !outraTag.ok || !semNada.ok) throw new Error('setup falhou')

    // Uma das duas tags do script basta — e' contencao de array, nao igualdade.
    const porTag = await store.listar({ tag: 'whatsapp' })
    if (!porTag.ok) throw new Error(porTag.erro)
    expect(porTag.valor.map((s) => s.id)).toEqual([comDuasTags.valor])

    const porEtapa = await store.listar({ stageId: contato })
    if (!porEtapa.ok) throw new Error(porEtapa.erro)
    expect(porEtapa.valor.map((s) => s.id)).toEqual([outraTag.valor])

    const tudo = await store.listar({})
    if (!tudo.ok) throw new Error(tudo.erro)
    expect(tudo.valor).toHaveLength(3)
  })

  it('Caso 4a: paraEtapa devolve a etapa primeiro e os sem etapa depois, e deixa outra etapa de fora', async () => {
    const store = await storeDe(c.gestorId)
    const x = etapa(c, 'Novo lead')
    const y = etapa(c, 'Proposta')

    // Titulos escolhidos para que a particao contrarie a ordenacao alfabetica:
    // 'Alfa' (sem etapa) viria antes de 'Zeta' (etapa X) por titulo, e mesmo
    // assim o da etapa tem que aparecer primeiro. Se paraEtapa devolvesse a
    // ordem crua do banco, a asserção abaixo inverteria.
    const daEtapa = await store.criar({ titulo: 'Zeta', conteudo: 'x', stageId: x, tags: [] })
    const semEtapa = await store.criar({ titulo: 'Alfa', conteudo: 'y', stageId: null, tags: [] })
    const deOutra = await store.criar({ titulo: 'Beta', conteudo: 'z', stageId: y, tags: [] })
    if (!daEtapa.ok || !semEtapa.ok || !deOutra.ok) throw new Error('setup falhou')

    const r = await store.paraEtapa(x)
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor.map((s) => s.id)).toEqual([daEtapa.valor, semEtapa.valor])
    expect(r.valor.map((s) => s.id)).not.toContain(deOutra.valor)
  })

  it('Caso 4b: titulo identico desempata por id asc, nao pela ordem fisica da tabela', async () => {
    const store = await storeDe(c.gestorId)
    const x = etapa(c, 'Novo lead')

    // Ids fixos e insercao FISICA na ordem inversa: o de id maior entra
    // primeiro na tabela. Sem `.order('id')` o seq scan devolveria a ordem
    // fisica e a asserção inverteria — nao ha sorte envolvida.
    const MAIOR = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    const MENOR = '00000000-0000-4000-8000-000000000001'
    await inserirScript({
      id: MAIOR,
      accountId: c.accountId,
      titulo: 'Mesmo titulo',
      stageId: x,
      criadoPor: c.gestorId,
    })
    await inserirScript({
      id: MENOR,
      accountId: c.accountId,
      titulo: 'Mesmo titulo',
      stageId: x,
      criadoPor: c.gestorId,
    })

    // Chamadas repetidas: estabilidade e' o ponto, nao um acerto isolado.
    for (let i = 0; i < 3; i++) {
      const r = await store.paraEtapa(x)
      if (!r.ok) throw new Error(r.erro)
      expect(r.valor.map((s) => s.id)).toEqual([MENOR, MAIOR])

      const l = await store.listar({})
      if (!l.ok) throw new Error(l.erro)
      expect(l.valor.map((s) => s.id)).toEqual([MENOR, MAIOR])
    }
  })

  it('Caso 5: buscar de script de outra conta devolve null, mesmo para quem e membro das duas', async () => {
    const b = await segundaContaComEtapa('Conta B', 'admin-b-5@b.com')
    await adicionarMembership(b.accountId, c.adminId, 'gestor')

    const scriptB = await inserirScript({
      accountId: b.accountId,
      titulo: 'Script da conta B',
      stageId: b.stageId,
      criadoPor: b.adminId,
    })
    const scriptA = await inserirScript({
      accountId: c.accountId,
      titulo: 'Script da conta A',
      criadoPor: c.adminId,
    })

    const cliente = await clienteDoUsuario(c.adminId)
    const store = new SupabaseScriptStore(cliente, c.accountId, c.adminId)

    const r = await store.buscar(scriptB)
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor).toBeNull()

    // Nao-vacuo: a RLS SOZINHA deixaria ver, porque is_member_of e' verdadeiro
    // para as duas contas. Sem esta asserção, a de cima passaria mesmo num
    // store que confiasse so na RLS.
    const { data, error } = await cliente.from('scripts').select('id').eq('id', scriptB)
    if (error) throw new Error(error.message)
    expect(data).toHaveLength(1)

    // E o caminho feliz continua vivo — o filtro nao cegou a propria conta.
    const proprio = await store.buscar(scriptA)
    if (!proprio.ok) throw new Error(proprio.erro)
    expect(proprio.valor?.id).toBe(scriptA)

    // Id inexistente tambem e' ok(null), nunca falha: a pagina responde
    // notFound(), nunca 403.
    const inexistente = await store.buscar('00000000-0000-0000-0000-000000000000')
    if (!inexistente.ok) throw new Error(inexistente.erro)
    expect(inexistente.valor).toBeNull()

    // Listar tambem nao mistura as contas.
    const lista = await store.listar({})
    if (!lista.ok) throw new Error(lista.erro)
    expect(lista.valor.map((s) => s.id)).toEqual([scriptA])
  })

  it('Caso 5b: id que nem e uuid e ok(null), nao falha tecnica — /scripts/abc responde 404', async () => {
    const store = await storeDe(c.adminId)

    // O Postgres recusa 'nao-e-uuid' no `=` da coluna uuid com 22P02
    // (invalid_text_representation) e o PostgREST devolve isso como erro. Se o
    // store tratasse como falha generica, /scripts/abc renderizaria "Nao foi
    // possivel carregar os scripts" em vez do notFound() que a rota promete —
    // e qualquer link velho ou digitacao errada viraria erro de sistema.
    const r = await store.buscar('nao-e-uuid')
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor).toBeNull()
  })

  it('Caso 6: criar com etapa de outra conta ou etapa inexistente falha com etapa_invalida', async () => {
    const b = await segundaContaComEtapa('Conta B', 'admin-b-6@b.com')
    const store = await storeDe(c.gestorId)

    // stage_da_conta devolve false: o with check de scripts_insert nega com
    // 42501. Se a traducao tratasse 42501 como generico, viria
    // erro_ao_salvar_script e a tela nao saberia dizer "escolha outra etapa".
    const alheia = await store.criar({
      titulo: 'Etapa alheia',
      conteudo: 'x',
      stageId: b.stageId,
      tags: [],
    })
    expect(alheia.ok).toBe(false)
    if (alheia.ok) throw new Error('nao deveria ter sucesso')
    expect(alheia.erro).toBe('etapa_invalida')

    // Etapa inexistente chega pelo MESMO caminho (0020, caso 5: morre no with
    // check antes da FK), entao tem que dar o mesmo codigo.
    const inexistente = await store.criar({
      titulo: 'Etapa fantasma',
      conteudo: 'x',
      stageId: '00000000-0000-0000-0000-000000000000',
      tags: [],
    })
    expect(inexistente.ok).toBe(false)
    if (inexistente.ok) throw new Error('nao deveria ter sucesso')
    expect(inexistente.erro).toBe('etapa_invalida')

    // Nenhuma das duas gravou nada.
    const n = await comoServico(async (cli) =>
      (await cli.query<{ n: number }>('select count(*)::int as n from public.scripts')).rows[0].n,
    )
    expect(n).toBe(0)
  })

  it('Caso 7: vendedor nao atualiza nem exclui — script_nao_encontrado e a linha intacta', async () => {
    const id = await inserirScript({
      accountId: c.accountId,
      titulo: 'Original',
      conteudo: 'conteudo original',
      stageId: etapa(c, 'Novo lead'),
      tags: ['frio'],
      criadoPor: c.gestorId,
    })
    const store = await storeDe(c.vendedorAId)

    // O `using` de scripts_update esconde a linha do vendedor: zero linhas,
    // sem erro. Um sucesso mudo aqui seria o defeito.
    const atualizou = await store.atualizar(id, {
      titulo: 'Alterado',
      conteudo: 'alterado',
      stageId: null,
      tags: ['quente'],
    })
    expect(atualizou.ok).toBe(false)
    if (atualizou.ok) throw new Error('nao deveria ter sucesso')
    expect(atualizou.erro).toBe('script_nao_encontrado')

    const excluiu = await store.excluir(id)
    expect(excluiu.ok).toBe(false)
    if (excluiu.ok) throw new Error('nao deveria ter sucesso')
    expect(excluiu.erro).toBe('script_nao_encontrado')

    const linha = await lerScript(id)
    expect(linha?.titulo).toBe('Original')
    expect(linha?.conteudo).toBe('conteudo original')
    expect(linha?.tags).toEqual(['frio'])

    // E o gestor, esse atualiza — normalizando as tags e carimbando
    // atualizado_em pela aplicacao (nao ha trigger neste repo). O valor e'
    // regredido antes para a comparacao discriminar de verdade, como em
    // tarefas-store.test.ts.
    const PASSADO = '2020-01-01T00:00:00.000Z'
    await comoServico((cli) =>
      cli.query('update public.scripts set atualizado_em = $1 where id = $2', [PASSADO, id]),
    )
    const storeGestor = await storeDe(c.gestorId)
    const okAtualizar = await storeGestor.atualizar(id, {
      titulo: 'Alterado',
      conteudo: 'alterado',
      stageId: null,
      tags: [' Quente ', 'QUENTE'],
    })
    expect(okAtualizar.ok).toBe(true)

    const depois = await lerScript(id)
    expect(depois?.titulo).toBe('Alterado')
    expect(depois?.stage_id).toBeNull()
    expect(depois?.tags).toEqual(['quente'])
    expect(new Date(depois!.atualizado_em).getTime()).toBeGreaterThan(new Date(PASSADO).getTime())

    const excluiuGestor = await storeGestor.excluir(id)
    expect(excluiuGestor.ok).toBe(true)
    expect(await lerScript(id)).toBeUndefined()
  })

  it('Caso 8: tagsDaConta deduplica entre scripts, ordena e nao vaza a conta vizinha', async () => {
    const b = await segundaContaComEtapa('Conta B', 'admin-b-8@b.com')
    await adicionarMembership(b.accountId, c.adminId, 'gestor')

    await inserirScript({
      accountId: c.accountId,
      titulo: 'A1',
      tags: ['preço', 'objeção'],
      criadoPor: c.adminId,
    })
    await inserirScript({
      accountId: c.accountId,
      titulo: 'A2',
      tags: ['whatsapp', 'preço'],
      criadoPor: c.adminId,
    })
    await inserirScript({
      accountId: c.accountId,
      titulo: 'A3',
      tags: [],
      criadoPor: c.adminId,
    })
    const scriptB = await inserirScript({
      accountId: b.accountId,
      titulo: 'B1',
      tags: ['exclusiva-da-b'],
      criadoPor: b.adminId,
    })

    const cliente = await clienteDoUsuario(c.adminId)
    const store = new SupabaseScriptStore(cliente, c.accountId, c.adminId)

    const r = await store.tagsDaConta()
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor).toEqual(['objeção', 'preço', 'whatsapp'])
    expect(r.valor).not.toContain('exclusiva-da-b')

    // Nao-vacuo pelo mesmo motivo do Caso 5: o usuario e membro de B, entao a
    // RLS sozinha traria a tag de B para dentro da uniao.
    const { data, error } = await cliente.from('scripts').select('id').eq('id', scriptB)
    if (error) throw new Error(error.message)
    expect(data).toHaveLength(1)
  })
})
