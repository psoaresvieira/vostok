import { describe, it, expect, beforeEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import {
  SupabaseTemplateStore,
  criarDisparoServico,
  type DadosTemplate,
} from '@/lib/data/templates'
import { comoServico, comoUsuario, limparBanco } from './helpers/db'
import { clienteDoUsuario } from './helpers/cliente'
import { montarCenario, etapa, type Cenario } from './helpers/cenario'
import { SEGREDO } from './helpers/ingestao'

/**
 * TemplateStore (sessao) e DisparoServico (anon + segredo). Forma copiada de
 * `scripts-store.test.ts`: cenario por `beforeEach`, store montado sobre
 * `clienteDoUsuario` (RLS de verdade), e a tecnica de nao-vacuidade da dupla
 * membership — o client CRU do usuario ve a linha alheia, e o store nao a
 * devolve. A conexao do WhatsApp do Caso 5 e semeada pelo padrao do Caso 8 de
 * `0019_conexao_whatsapp.test.ts` (RPC `conectar_whatsapp` com o segredo).
 */

const TOKEN = 'EAAG-token-whatsapp-falso'

async function segundaContaComScript(
  nome: string,
  email: string,
): Promise<{ accountId: string; adminId: string; scriptId: string }> {
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
    const s = await cli.query<{ id: string }>(
      `insert into public.scripts (account_id, titulo, conteudo, criado_por)
       values ($1, 'Script da conta B', 'Ola {{primeiro_nome}}', $2) returning id`,
      [a.rows[0].id, u.rows[0].id],
    )
    return { accountId: a.rows[0].id, adminId: u.rows[0].id, scriptId: s.rows[0].id }
  })
}

/** Membership extra pelo servico: e' o que torna o usuario membro de DUAS
 * contas, condicao para o caso em que a RLS (is_member_of) sozinha deixaria
 * ver a conta errada. */
async function adicionarMembership(accountId: string, userId: string, papel: string) {
  await comoServico((cli) =>
    cli.query(
      `insert into public.memberships (account_id, user_id, papel) values ($1, $2, $3)`,
      [accountId, userId, papel],
    ),
  )
}

/** Script da conta do cenario, inserido pelo servico: o store de templates nao
 * cria scripts, e o `exists` do with check exige um script da mesma conta. */
async function criarScript(c: Cenario, titulo = 'Abordagem inicial'): Promise<string> {
  const novo = etapa(c, 'Novo lead')
  return comoServico(
    async (cli) =>
      (
        await cli.query<{ id: string }>(
          `insert into public.scripts (account_id, titulo, conteudo, stage_id, criado_por)
           values ($1, $2, 'Ola {{primeiro_nome}}, aqui e da {{empresa}}.', $3, $4) returning id`,
          [c.accountId, titulo, novo, c.gestorId],
        )
      ).rows[0].id,
  )
}

/** Insere direto, ignorando RLS e o proprio store: e' o unico jeito de semear
 * template em conta onde o usuario sob teste nao escreve, e de fixar colunas
 * que o store nao grava (motivo_rejeicao, status_consultado_em). */
async function inserirTemplate(d: {
  accountId: string
  scriptId: string
  nomeMeta?: string
  status?: string
  motivoRejeicao?: string | null
  statusConsultadoEm?: string | null
}): Promise<string> {
  return comoServico(async (cli) => {
    const r = await cli.query<{ id: string }>(
      `insert into public.whatsapp_templates
         (account_id, script_id, nome_meta, idioma, categoria, corpo_posicional, mapa,
          status, motivo_rejeicao, status_consultado_em)
       values ($1, $2, $3, 'pt_BR', 'marketing', 'Ola {{1}}', '{primeiro_nome}',
               $4, $5, $6) returning id`,
      [
        d.accountId,
        d.scriptId,
        d.nomeMeta ?? 'template_semeado',
        d.status ?? 'pending',
        d.motivoRejeicao ?? null,
        d.statusConsultadoEm ?? null,
      ],
    )
    return r.rows[0].id
  })
}

async function lerTemplate(id: string) {
  return comoServico(async (cli) => {
    const r = await cli.query(
      `select id, account_id, script_id, nome_meta, idioma, categoria, corpo_posicional,
              mapa, status, motivo_rejeicao, template_id_meta, status_consultado_em,
              atualizado_em
         from public.whatsapp_templates where id = $1`,
      [id],
    )
    return r.rows[0] as
      | {
          id: string
          account_id: string
          script_id: string
          nome_meta: string
          idioma: string
          categoria: string
          corpo_posicional: string
          mapa: string[]
          status: string
          motivo_rejeicao: string | null
          template_id_meta: string | null
          status_consultado_em: string | null
          atualizado_em: string
        }
      | undefined
  })
}

function dados(scriptId: string, over: Partial<DadosTemplate> = {}): DadosTemplate {
  return {
    scriptId,
    nomeMeta: 'abordagem_inicial_a1b2',
    idioma: 'pt_BR',
    categoria: 'marketing',
    corpoPosicional: 'Ola {{1}}, aqui e da {{2}}.',
    mapa: ['primeiro_nome', 'empresa'],
    status: 'pending',
    templateIdMeta: 'meta-tpl-1',
    ...over,
  }
}

/** Conexao do WhatsApp da conta do cenario, pela RPC — mesma tecnica de
 * `conectarA` em 0019_conexao_whatsapp.test.ts. */
async function conectarWhatsApp(c: Cenario) {
  return comoUsuario(c.adminId, async (cli) => {
    const r = await cli.query<{ id: string }>(
      'select public.conectar_whatsapp($1, $2, $3, $4, $5, $6, $7) as id',
      [
        SEGREDO,
        c.accountId,
        'phone-a-1',
        'waba-a-1',
        '+55 11 90000-0001',
        'SE7E Trafego',
        TOKEN,
      ],
    )
    return r.rows[0].id
  })
}

describe('SupabaseTemplateStore e DisparoServico', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  async function storeDe(usuarioId: string, contaId?: string) {
    const cliente = await clienteDoUsuario(usuarioId)
    return new SupabaseTemplateStore(cliente, contaId ?? c.accountId)
  }

  function servico() {
    const s = criarDisparoServico()
    if (!s.ok) throw new Error(s.erro)
    return s.valor
  }

  it('Caso 1: criar grava o snapshot e doScript devolve o mapeamento camelCase, com Date e mapa como array', async () => {
    const store = await storeDe(c.gestorId)
    const scriptId = await criarScript(c)

    const criado = await store.criar(dados(scriptId))
    if (!criado.ok) throw new Error(criado.erro)

    // Relido PELO SERVICO, nao pelo valor devolvido: o snapshot tem que ter
    // chegado ao banco nas colunas certas — inclusive account_id, que o store
    // preenche sozinho, e template_id_meta, que so o insert grava.
    const linha = await lerTemplate(criado.valor)
    expect(linha?.account_id).toBe(c.accountId)
    expect(linha?.script_id).toBe(scriptId)
    expect(linha?.nome_meta).toBe('abordagem_inicial_a1b2')
    expect(linha?.idioma).toBe('pt_BR')
    expect(linha?.categoria).toBe('marketing')
    expect(linha?.corpo_posicional).toBe('Ola {{1}}, aqui e da {{2}}.')
    expect(linha?.mapa).toEqual(['primeiro_nome', 'empresa'])
    expect(linha?.status).toBe('pending')
    expect(linha?.template_id_meta).toBe('meta-tpl-1')

    const r = await store.doScript(scriptId)
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor).toMatchObject({
      id: criado.valor,
      scriptId,
      nomeMeta: 'abordagem_inicial_a1b2',
      idioma: 'pt_BR',
      categoria: 'marketing',
      corpoPosicional: 'Ola {{1}}, aqui e da {{2}}.',
      mapa: ['primeiro_nome', 'empresa'],
      status: 'pending',
      motivoRejeicao: null,
      statusConsultadoEm: null,
    })
    expect(Array.isArray(r.valor?.mapa)).toBe(true)
    expect(r.valor?.criadoEm).toBeInstanceOf(Date)

    // Script sem template e' ok(null), nunca falha: e' o estado inicial de
    // todo script e a tela renderiza "Submeter ao WhatsApp".
    const outro = await criarScript(c, 'Sem template')
    const vazio = await store.doScript(outro)
    if (!vazio.ok) throw new Error(vazio.erro)
    expect(vazio.valor).toBeNull()
  })

  it('Caso 2: dosScripts devolve os templates dos scripts pedidos e nunca o de outra conta, mesmo para quem e membro das duas', async () => {
    const b = await segundaContaComScript('Conta B', 'admin-b-tpl@b.com')
    await adicionarMembership(b.accountId, c.adminId, 'gestor')

    const script1 = await criarScript(c, 'Um')
    const script2 = await criarScript(c, 'Dois')
    const script3 = await criarScript(c, 'Tres sem template')
    const t1 = await inserirTemplate({
      accountId: c.accountId,
      scriptId: script1,
      nomeMeta: 'um',
    })
    const t2 = await inserirTemplate({
      accountId: c.accountId,
      scriptId: script2,
      nomeMeta: 'dois',
    })
    const tB = await inserirTemplate({
      accountId: b.accountId,
      scriptId: b.scriptId,
      nomeMeta: 'da_conta_b',
    })

    const cliente = await clienteDoUsuario(c.adminId)
    const store = new SupabaseTemplateStore(cliente, c.accountId)

    const r = await store.dosScripts([script1, script2, script3, b.scriptId])
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor.map((t) => t.id).sort()).toEqual([t1, t2].sort())
    expect(r.valor.map((t) => t.id)).not.toContain(tB)

    // Nao-vacuo: a RLS SOZINHA deixaria ver, porque is_member_of e' verdadeiro
    // para as duas contas. Sem esta asserção, a de cima passaria mesmo num
    // store que confiasse so no `.in(script_id)` mais a RLS.
    const { data, error } = await cliente.from('whatsapp_templates').select('id').eq('id', tB)
    if (error) throw new Error(error.message)
    expect(data).toHaveLength(1)

    // O mesmo filtro protege a leitura por script: `doScript` do script da
    // conta B, com a conta A ativa, e' ok(null) — nao o template de B.
    const alheio = await store.doScript(b.scriptId)
    if (!alheio.ok) throw new Error(alheio.erro)
    expect(alheio.valor).toBeNull()

    // Lista vazia nao vira consulta: `.in('script_id', [])` e' borda do
    // PostgREST (`in.()`), e a resposta certa nao depende do banco. O store
    // montado sobre um endereco MORTO e' o que torna a asserção nao-vacua:
    // qualquer consulta emitida aqui viraria erro de rede, nunca ok([]).
    const morto = createClient('http://127.0.0.1:1', 'anon-que-nunca-vai-ser-usada', {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const semRede = new SupabaseTemplateStore(morto, c.accountId)
    const nenhum = await semRede.dosScripts([])
    if (!nenhum.ok) throw new Error(nenhum.erro)
    expect(nenhum.valor).toEqual([])
  })

  it('Caso 3: substituir troca corpo, nome e status e limpa a rejeicao antiga; zero linhas devolve template_nao_encontrado', async () => {
    const scriptId = await criarScript(c)
    const id = await inserirTemplate({
      accountId: c.accountId,
      scriptId,
      nomeMeta: 'nome_antigo',
      status: 'rejected',
      motivoRejeicao: 'texto muito promocional',
      statusConsultadoEm: '2020-01-01T00:00:00.000Z',
    })
    const PASSADO = '2020-01-01T00:00:00.000Z'
    await comoServico((cli) =>
      cli.query('update public.whatsapp_templates set atualizado_em = $1 where id = $2', [
        PASSADO,
        id,
      ]),
    )

    const store = await storeDe(c.gestorId)
    const r = await store.substituir(
      id,
      dados(scriptId, {
        nomeMeta: 'nome_novo_c3d4',
        corpoPosicional: 'Novo corpo com {{1}}.',
        mapa: ['empresa'],
        status: 'pending',
        templateIdMeta: 'meta-tpl-2',
      }),
    )
    expect(r.ok).toBe(true)

    const linha = await lerTemplate(id)
    expect(linha?.nome_meta).toBe('nome_novo_c3d4')
    expect(linha?.corpo_posicional).toBe('Novo corpo com {{1}}.')
    expect(linha?.mapa).toEqual(['empresa'])
    expect(linha?.status).toBe('pending')
    expect(linha?.template_id_meta).toBe('meta-tpl-2')
    // A rejeicao era do template ANTIGO: mante-la ao lado de um 'pending' novo
    // faria a tela mostrar "recusado porque X" sobre uma analise em curso.
    expect(linha?.motivo_rejeicao).toBeNull()
    expect(linha?.status_consultado_em).toBeNull()
    expect(new Date(linha!.atualizado_em).getTime()).toBeGreaterThan(new Date(PASSADO).getTime())

    // Id inexistente: zero linhas, sem erro do Postgres. Um sucesso mudo aqui
    // seria o defeito.
    const fantasma = await store.substituir(
      '00000000-0000-0000-0000-000000000000',
      dados(scriptId),
    )
    expect(fantasma.ok).toBe(false)
    if (fantasma.ok) throw new Error('nao deveria ter sucesso')
    expect(fantasma.erro).toBe('template_nao_encontrado')

    // Vendedor: o `using` de whatsapp_templates_update esconde a linha —
    // tambem zero linhas, e a linha fica intacta.
    const storeVendedor = await storeDe(c.vendedorAId)
    const vendedor = await storeVendedor.substituir(
      id,
      dados(scriptId, { nomeMeta: 'do_vendedor', status: 'approved' }),
    )
    expect(vendedor.ok).toBe(false)
    if (vendedor.ok) throw new Error('nao deveria ter sucesso')
    expect(vendedor.erro).toBe('template_nao_encontrado')

    const excluiuVendedor = await storeVendedor.excluir(id)
    expect(excluiuVendedor.ok).toBe(false)
    if (excluiuVendedor.ok) throw new Error('nao deveria ter sucesso')
    expect(excluiuVendedor.erro).toBe('template_nao_encontrado')

    const depois = await lerTemplate(id)
    expect(depois?.nome_meta).toBe('nome_novo_c3d4')
    expect(depois?.status).toBe('pending')

    // E o gestor exclui de verdade — sem esta parte, um `excluir` que nunca
    // apagasse nada passaria no arquivo inteiro.
    const excluiu = await store.excluir(id)
    expect(excluiu.ok).toBe(true)
    expect(await lerTemplate(id)).toBeUndefined()
  })

  it('Caso 4: criar duplicado no mesmo script (ou com nome ja usado na conta) devolve template_ja_existe, e vendedor leva sem_permissao', async () => {
    const store = await storeDe(c.gestorId)
    const scriptId = await criarScript(c)
    const outroScript = await criarScript(c, 'Outro')

    const primeiro = await store.criar(dados(scriptId))
    if (!primeiro.ok) throw new Error(primeiro.erro)

    // whatsapp_templates_script_idx: a dupla submissao (dois cliques, duas
    // abas) chega aqui como 23505, e a tela precisa dizer "recarregue a
    // pagina", nao "erro ao salvar".
    const duplicado = await store.criar(dados(scriptId, { nomeMeta: 'outro_nome_ef56' }))
    expect(duplicado.ok).toBe(false)
    if (duplicado.ok) throw new Error('nao deveria ter sucesso')
    expect(duplicado.erro).toBe('template_ja_existe')

    // whatsapp_templates_nome_idx: script diferente, mesmo nome_meta na conta.
    const mesmoNome = await store.criar(dados(outroScript))
    expect(mesmoNome.ok).toBe(false)
    if (mesmoNome.ok) throw new Error('nao deveria ter sucesso')
    expect(mesmoNome.erro).toBe('template_ja_existe')

    // 42501 do with check (papel vendedor) e' `sem_permissao`, nao o generico:
    // e' a unica falha de escrita aqui em que a acao do usuario e' diferente.
    const storeVendedor = await storeDe(c.vendedorAId)
    const vendedor = await storeVendedor.criar(dados(outroScript, { nomeMeta: 'do_vendedor_78' }))
    expect(vendedor.ok).toBe(false)
    if (vendedor.ok) throw new Error('nao deveria ter sucesso')
    expect(vendedor.erro).toBe('sem_permissao')

    const n = await comoServico(
      async (cli) =>
        (await cli.query<{ n: number }>('select count(*)::int as n from public.whatsapp_templates'))
          .rows[0].n,
    )
    expect(n).toBe(1)
  })

  it('Caso 5: credencial do servico devolve o que conectar_whatsapp gravou, e sem conexao devolve sem_conexao_whatsapp', async () => {
    await conectarWhatsApp(c)

    const r = await servico().credencial(c.accountId)
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor).toEqual({
      token: TOKEN,
      phoneNumberId: 'phone-a-1',
      wabaId: 'waba-a-1',
    })

    const b = await segundaContaComScript('Conta B', 'admin-b-cred@b.com')
    const semConexao = await servico().credencial(b.accountId)
    expect(semConexao.ok).toBe(false)
    if (semConexao.ok) throw new Error('nao deveria ter sucesso')
    expect(semConexao.erro).toBe('sem_conexao_whatsapp')
  })

  it('Caso 6: atualizarStatus do servico anon (sem sessao) persiste status minusculo e motivo, e o store rele o valor novo', async () => {
    const store = await storeDe(c.gestorId)
    const scriptId = await criarScript(c)
    const criado = await store.criar(dados(scriptId))
    if (!criado.ok) throw new Error(criado.erro)

    // Sem sessao nenhuma: o client do servico e anon + segredo, e e' esse o
    // caminho de producao (a consulta de status roda quando qualquer membro
    // renderiza a tela, inclusive vendedor, que nao escreve na tabela).
    const r = await servico().atualizarStatus(criado.valor, 'REJECTED', 'texto muito promocional')
    expect(r.ok).toBe(true)

    const relido = await store.doScript(scriptId)
    if (!relido.ok) throw new Error(relido.erro)
    expect(relido.valor?.status).toBe('rejected')
    expect(relido.valor?.motivoRejeicao).toBe('texto muito promocional')
    expect(relido.valor?.statusConsultadoEm).toBeInstanceOf(Date)
    // A RPC escreve SO status/motivo/carimbo: o snapshot fica de pe.
    expect(relido.valor?.corpoPosicional).toBe('Ola {{1}}, aqui e da {{2}}.')
    expect(relido.valor?.mapa).toEqual(['primeiro_nome', 'empresa'])

    const fantasma = await servico().atualizarStatus(
      '00000000-0000-0000-0000-000000000000',
      'approved',
      null,
    )
    expect(fantasma.ok).toBe(false)
    if (fantasma.ok) throw new Error('nao deveria ter sucesso')
    expect(fantasma.erro).toBe('template_nao_encontrado')
  })

  it('Caso 7: servico com INGESTAO_SEGREDO vazio devolve ingestao_nao_configurada sem tocar rede nem banco', async () => {
    const segredoOriginal = process.env.INGESTAO_SEGREDO
    const urlOriginal = process.env.NEXT_PUBLIC_SUPABASE_URL
    try {
      process.env.INGESTAO_SEGREDO = ''
      const semSegredo = criarDisparoServico()
      expect(semSegredo.ok).toBe(false)
      if (semSegredo.ok) throw new Error('nao deveria ter sucesso')
      expect(semSegredo.erro).toBe('ingestao_nao_configurada')

      // A url tambem e' guarda de configuracao, e nao um `!` que estouraria
      // dentro da pagina como excecao sem Resultado.
      process.env.INGESTAO_SEGREDO = segredoOriginal
      process.env.NEXT_PUBLIC_SUPABASE_URL = ''
      const semUrl = criarDisparoServico()
      expect(semUrl.ok).toBe(false)
      if (semUrl.ok) throw new Error('nao deveria ter sucesso')
      expect(semUrl.erro).toBe('ingestao_nao_configurada')
    } finally {
      process.env.INGESTAO_SEGREDO = segredoOriginal
      process.env.NEXT_PUBLIC_SUPABASE_URL = urlOriginal
    }

    // Nao-vacuo: com segredo PRESENTE porem errado, a fabrica monta o cliente e
    // a chamada chega ao banco, que responde segredo_invalido. E' o contraste
    // que prova que o caso de cima recusou ANTES da rede, e nao que a rede
    // esteja simplesmente morta no ambiente de teste.
    try {
      process.env.INGESTAO_SEGREDO = 'segredo-errado'
      const comSegredoErrado = criarDisparoServico()
      if (!comSegredoErrado.ok) throw new Error(comSegredoErrado.erro)
      const r = await comSegredoErrado.valor.credencial(c.accountId)
      expect(r.ok).toBe(false)
      if (r.ok) throw new Error('nao deveria ter sucesso')
      expect(r.erro).toBe('segredo_invalido')
    } finally {
      process.env.INGESTAO_SEGREDO = segredoOriginal
    }
  })
})
