import { describe, it, expect, beforeEach } from 'vitest'
import { comoServico, comoUsuario, limparBanco } from './helpers/db'
import { montarCenario, type Cenario } from './helpers/cenario'

const TOKEN = 'EAAG-token-de-pagina-falso'

/** Uma segunda conta completa, com admin proprio. */
async function outraContaComAdmin(
  nome: string,
  email: string,
): Promise<{ accountId: string; adminId: string }> {
  return comoServico(async (cli) => {
    const u = await cli.query<{ id: string }>(
      `insert into auth.users (id, aud, role, email)
       values (gen_random_uuid(), 'authenticated', 'authenticated', $1) returning id`,
      [email],
    )
    await cli.query(
      `insert into public.profiles (id, nome, email) values ($1, 'Admin', $2)
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
    return { accountId: a.rows[0].id, adminId: u.rows[0].id }
  })
}

describe('0008 — fontes conectadas', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  it('admin conecta uma Page e a credencial fica gravada', async () => {
    const sourceId = await comoUsuario(c.adminId, async (cli) => {
      const r = await cli.query<{ id: string }>(
        'select public.conectar_fonte_meta($1, $2, $3, $4, $5) as id',
        [c.accountId, '1234567890', 'Page da SE7E', TOKEN, c.vendedorAId],
      )
      return r.rows[0].id
    })

    const linha = await comoServico(async (cli) => {
      const r = await cli.query(
        `select s.provedor, s.external_id, s.responsavel_padrao_id, s.ativo,
                cr.meta_page_token
           from public.lead_sources s
           join public.source_credentials cr on cr.source_id = s.id
          where s.id = $1`,
        [sourceId],
      )
      return r.rows[0]
    })
    expect(linha.provedor).toBe('meta')
    expect(linha.external_id).toBe('1234567890')
    expect(linha.responsavel_padrao_id).toBe(c.vendedorAId)
    expect(linha.ativo).toBe(true)
    expect(linha.meta_page_token).toBe(TOKEN)
  })

  it('a mesma Page nao pode ser conectada por duas contas', async () => {
    await comoUsuario(c.adminId, (cli) =>
      cli.query('select public.conectar_fonte_meta($1, $2, $3, $4, null)', [
        c.accountId,
        '999',
        'Page A',
        TOKEN,
      ]),
    )
    const outra = await outraContaComAdmin('Conta B', 'b@b.com')

    await expect(
      comoUsuario(outra.adminId, (cli) =>
        cli.query('select public.conectar_fonte_meta($1, $2, $3, $4, null)', [
          outra.accountId,
          '999',
          'Page A de novo',
          TOKEN,
        ]),
      ),
    ).rejects.toThrow(/page_ja_conectada/)
  })

  it('varias fontes do Google convivem na mesma conta', async () => {
    await comoUsuario(c.adminId, async (cli) => {
      await cli.query('select public.conectar_fonte_google($1, $2, $3, $4, null)', [
        c.accountId,
        'Formulario A',
        'token-a',
        'chave-a',
      ])
      await cli.query('select public.conectar_fonte_google($1, $2, $3, $4, null)', [
        c.accountId,
        'Formulario B',
        'token-b',
        'chave-b',
      ])
    })

    const n = await comoServico(async (cli) => {
      const r = await cli.query<{ n: string }>(
        `select count(*) as n from public.lead_sources where provedor = 'google'`,
      )
      return r.rows[0].n
    })
    // external_id nulo nos dois: indice unico nao compara NULL com NULL.
    expect(n).toBe('2')
  })

  it('guarda o hash do token da URL, nunca o token', async () => {
    await comoUsuario(c.adminId, (cli) =>
      cli.query('select public.conectar_fonte_google($1, $2, $3, $4, null)', [
        c.accountId,
        'Formulario',
        'token-secreto',
        'chave',
      ]),
    )
    const cred = await comoServico(async (cli) => {
      const r = await cli.query<{ url_token_hash: string; google_key_hash: string }>(
        'select url_token_hash, google_key_hash from public.source_credentials',
      )
      return r.rows[0]
    })
    expect(cred.url_token_hash).not.toBe('token-secreto')
    expect(cred.url_token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(cred.google_key_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('gestor nao conecta fonte', async () => {
    await expect(
      comoUsuario(c.gestorId, (cli) =>
        cli.query('select public.conectar_fonte_meta($1, $2, $3, $4, null)', [
          c.accountId,
          '777',
          'Page',
          TOKEN,
        ]),
      ),
    ).rejects.toThrow(/sem_permissao/)
  })

  it('recusa responsavel padrao de fora da conta', async () => {
    const outra = await outraContaComAdmin('Conta D', 'd@d.com')
    await expect(
      comoUsuario(c.adminId, (cli) =>
        cli.query('select public.conectar_fonte_meta($1, $2, $3, $4, $5)', [
          c.accountId,
          '888',
          'Page',
          TOKEN,
          outra.adminId,
        ]),
      ),
    ).rejects.toThrow(/responsavel_invalido/)
  })

  it('authenticated nao le source_credentials de jeito nenhum', async () => {
    await comoUsuario(c.adminId, (cli) =>
      cli.query('select public.conectar_fonte_meta($1, $2, $3, $4, null)', [
        c.accountId,
        '111',
        'Page',
        TOKEN,
      ]),
    )
    // Nao e RLS devolvendo zero linhas: e falta de privilegio na tabela.
    await expect(
      comoUsuario(c.adminId, (cli) => cli.query('select * from public.source_credentials')),
    ).rejects.toThrow(/permission denied/i)
  })

  it('authenticated nao le ingestion_config', async () => {
    await expect(
      comoUsuario(c.adminId, (cli) => cli.query('select * from public.ingestion_config')),
    ).rejects.toThrow(/permission denied/i)
  })

  it('admin enxerga as fontes da propria conta e nao as de outra', async () => {
    await comoUsuario(c.adminId, (cli) =>
      cli.query('select public.conectar_fonte_meta($1, $2, $3, $4, null)', [
        c.accountId,
        '222',
        'Minha Page',
        TOKEN,
      ]),
    )
    const outra = await outraContaComAdmin('Conta E', 'e@e.com')
    await comoUsuario(outra.adminId, (cli) =>
      cli.query('select public.conectar_fonte_meta($1, $2, $3, $4, null)', [
        outra.accountId,
        '223',
        'Page alheia',
        TOKEN,
      ]),
    )

    const vistas = await comoUsuario(c.adminId, async (cli) => {
      const r = await cli.query<{ nome: string }>('select nome from public.lead_sources')
      return r.rows.map((l) => l.nome)
    })
    expect(vistas).toEqual(['Minha Page'])
  })

  it('vendedor nao enxerga fonte nenhuma', async () => {
    await comoUsuario(c.adminId, (cli) =>
      cli.query('select public.conectar_fonte_meta($1, $2, $3, $4, null)', [
        c.accountId,
        '333',
        'Page',
        TOKEN,
      ]),
    )
    const vistas = await comoUsuario(c.vendedorAId, async (cli) => {
      const r = await cli.query('select id from public.lead_sources')
      return r.rows
    })
    expect(vistas).toEqual([])
  })

  it('desconectar apaga fonte e credencial', async () => {
    const sourceId = await comoUsuario(c.adminId, async (cli) => {
      const r = await cli.query<{ id: string }>(
        'select public.conectar_fonte_meta($1, $2, $3, $4, null) as id',
        [c.accountId, '444', 'Page', TOKEN],
      )
      return r.rows[0].id
    })
    await comoUsuario(c.adminId, (cli) =>
      cli.query('select public.desconectar_fonte($1)', [sourceId]),
    )
    const restou = await comoServico(async (cli) => {
      const r = await cli.query<{ n: string }>(
        `select (select count(*) from public.lead_sources)
              + (select count(*) from public.source_credentials) as n`,
      )
      return r.rows[0].n
    })
    expect(restou).toBe('0')
  })

  it('admin de outra conta nao desconecta fonte alheia', async () => {
    const sourceId = await comoUsuario(c.adminId, async (cli) => {
      const r = await cli.query<{ id: string }>(
        'select public.conectar_fonte_meta($1, $2, $3, $4, null) as id',
        [c.accountId, '555', 'Page', TOKEN],
      )
      return r.rows[0].id
    })
    const outra = await outraContaComAdmin('Conta C', 'c@c.com')

    await expect(
      comoUsuario(outra.adminId, (cli) =>
        cli.query('select public.desconectar_fonte($1)', [sourceId]),
      ),
    ).rejects.toThrow(/sem_permissao/)
  })

  it('admin troca o responsavel padrao por update direto', async () => {
    const sourceId = await comoUsuario(c.adminId, async (cli) => {
      const r = await cli.query<{ id: string }>(
        'select public.conectar_fonte_meta($1, $2, $3, $4, null) as id',
        [c.accountId, '666', 'Page', TOKEN],
      )
      return r.rows[0].id
    })
    await comoUsuario(c.adminId, (cli) =>
      cli.query('update public.lead_sources set responsavel_padrao_id = $1 where id = $2', [
        c.vendedorBId,
        sourceId,
      ]),
    )
    const dono = await comoServico(async (cli) => {
      const r = await cli.query<{ responsavel_padrao_id: string }>(
        'select responsavel_padrao_id from public.lead_sources where id = $1',
        [sourceId],
      )
      return r.rows[0].responsavel_padrao_id
    })
    expect(dono).toBe(c.vendedorBId)
  })

  it('nao troca responsavel padrao para usuario de outra conta por update direto', async () => {
    const outra = await outraContaComAdmin('Conta F', 'f@f.com')
    const sourceId = await comoUsuario(c.adminId, async (cli) => {
      const r = await cli.query<{ id: string }>(
        'select public.conectar_fonte_meta($1, $2, $3, $4, null) as id',
        [c.accountId, '667', 'Page', TOKEN],
      )
      return r.rows[0].id
    })

    await expect(
      comoUsuario(c.adminId, (cli) =>
        cli.query('update public.lead_sources set responsavel_padrao_id = $1 where id = $2', [
          outra.adminId,
          sourceId,
        ]),
      ),
    ).rejects.toThrow(/row-level security/i)
  })

  it('conectar_fonte_google recusa token de URL vazio', async () => {
    await expect(
      comoUsuario(c.adminId, (cli) =>
        cli.query('select public.conectar_fonte_google($1, $2, $3, $4, null)', [
          c.accountId,
          'Formulario',
          '   ',
          'chave',
        ]),
      ),
    ).rejects.toThrow(/segredo_vazio/)
  })

  it('nao anula external_id de fonte meta por update direto (grant nao inclui a coluna)', async () => {
    const sourceId = await comoUsuario(c.adminId, async (cli) => {
      const r = await cli.query<{ id: string }>(
        'select public.conectar_fonte_meta($1, $2, $3, $4, null) as id',
        [c.accountId, '881', 'Page', TOKEN],
      )
      return r.rows[0].id
    })
    await expect(
      comoUsuario(c.adminId, (cli) =>
        cli.query('update public.lead_sources set external_id = null where id = $1', [sourceId]),
      ),
    ).rejects.toThrow(/permission denied/i)
  })

  it('conectar_fonte_meta recusa page id vazio, traduzido para codigo de dominio', async () => {
    await expect(
      comoUsuario(c.adminId, (cli) =>
        cli.query('select public.conectar_fonte_meta($1, $2, $3, $4, null)', [
          c.accountId,
          null,
          'Page',
          TOKEN,
        ]),
      ),
    ).rejects.toThrow(/page_id_invalido/)
  })

  // Ledger #15: o teste acima passa `null`, entao a metade `external_id <> ''`
  // do check nunca era exercitada, e page id so de espaco continuava aceito.
  // btrim alinha com conectar_fonte_google (0008:222) e cobre nulo e espaco
  // com o mesmo check.
  it('conectar_fonte_meta recusa page id so de espaco (btrim), traduzido para page_id_invalido', async () => {
    await expect(
      comoUsuario(c.adminId, (cli) =>
        cli.query('select public.conectar_fonte_meta($1, $2, $3, $4, null)', [
          c.accountId,
          '   ',
          'Page',
          TOKEN,
        ]),
      ),
    ).rejects.toThrow(/page_id_invalido/)
  })

  // Ledger #13: a remocao da definir_segredo_ingestao (falha de isolamento
  // entre contas corrigida na Task 5 — ver comentario em 0008) so era
  // defendida por comentario. Se alguem a reintroduzir, este teste denuncia.
  it('definir_segredo_ingestao nao existe (decisao de seguranca: nao reintroduzir)', async () => {
    const existe = await comoServico(async (cli) => {
      const r = await cli.query<{ existe: boolean }>(
        `select (to_regprocedure('public.definir_segredo_ingestao(uuid,text)') is not null) as existe`,
      )
      return r.rows[0].existe
    })
    expect(existe).toBe(false)
  })

  it('admin carimba atualizado_em por update direto (grant inclui a coluna)', async () => {
    const sourceId = await comoUsuario(c.adminId, async (cli) => {
      const r = await cli.query<{ id: string }>(
        'select public.conectar_fonte_meta($1, $2, $3, $4, null) as id',
        [c.accountId, '882', 'Page', TOKEN],
      )
      return r.rows[0].id
    })
    const novaData = new Date().toISOString()
    await comoUsuario(c.adminId, (cli) =>
      cli.query('update public.lead_sources set atualizado_em = $1 where id = $2', [
        novaData,
        sourceId,
      ]),
    )
    const linha = await comoServico(async (cli) => {
      const r = await cli.query<{ atualizado_em: string }>(
        'select atualizado_em from public.lead_sources where id = $1',
        [sourceId],
      )
      return r.rows[0]
    })
    expect(new Date(linha.atualizado_em).toISOString()).toBe(novaData)
  })

  it('funcoes de fonte recusam chamada sem sessao', async () => {
    await expect(
      comoServico((cli) =>
        cli.query('select public.conectar_fonte_meta($1, $2, $3, $4, null)', [
          c.accountId,
          '778',
          'Page',
          TOKEN,
        ]),
      ),
    ).rejects.toThrow(/sem_sessao/)

    await expect(
      comoServico((cli) =>
        cli.query('select public.conectar_fonte_google($1, $2, $3, $4, null)', [
          c.accountId,
          'Formulario sem sessao',
          'token-x',
          'chave-x',
        ]),
      ),
    ).rejects.toThrow(/sem_sessao/)

    await expect(
      comoServico((cli) =>
        cli.query('select public.desconectar_fonte($1)', [
          '00000000-0000-0000-0000-000000000000',
        ]),
      ),
    ).rejects.toThrow(/sem_sessao/)
  })

  it('desconectar_fonte de id inexistente devolve fonte_nao_encontrada', async () => {
    await expect(
      comoUsuario(c.adminId, (cli) =>
        cli.query('select public.desconectar_fonte($1)', ['00000000-0000-0000-0000-000000000000']),
      ),
    ).rejects.toThrow(/fonte_nao_encontrada/)
  })

})
