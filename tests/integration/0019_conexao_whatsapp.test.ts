import { describe, it, expect, beforeEach } from 'vitest'
import { comoServico, comoUsuario, limparBanco } from './helpers/db'
import { montarCenario, type Cenario } from './helpers/cenario'

/**
 * Conexao do WhatsApp Cloud API. Spec:
 * docs/superpowers/specs/2026-08-03-crm-conexao-whatsapp-design.md
 *
 * Mesmo segredo que supabase/seed.sql grava em ingestion_config — os dois tem
 * que andar juntos, e `npx supabase db reset` reseta o banco para este valor.
 * Padrao de teste copiado de 0012_posse_da_page.test.ts (segredo semeado) e
 * de 0008_fontes_conectadas.test.ts (segunda conta).
 */
const SEGREDO = 'segredo-de-ingestao-local'
const ERRADO = 'segredo-errado'
const TOKEN = 'EAAG-token-whatsapp-falso'

/** Uma segunda conta completa, com admin proprio. Mesmo helper do 0008/0012. */
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

/** Conecta a conta A com dados padrao — atalho usado por varios casos. */
async function conectarA(c: Cenario, overrides: Partial<Record<string, string>> = {}) {
  const args = {
    phoneNumberId: overrides.phoneNumberId ?? 'phone-a-1',
    wabaId: overrides.wabaId ?? 'waba-a-1',
    numeroExibicao: overrides.numeroExibicao ?? '+55 11 90000-0001',
    nomeVerificado: overrides.nomeVerificado ?? 'SE7E Trafego',
    token: overrides.token ?? TOKEN,
  }
  return comoUsuario(c.adminId, async (cli) => {
    const r = await cli.query<{ id: string }>(
      'select public.conectar_whatsapp($1, $2, $3, $4, $5, $6, $7) as id',
      [
        SEGREDO,
        c.accountId,
        args.phoneNumberId,
        args.wabaId,
        args.numeroExibicao,
        args.nomeVerificado,
        args.token,
      ],
    )
    return r.rows[0].id
  })
}

describe('0019 — conexao do WhatsApp: tabelas, credencial sem grant e as tres RPCs com segredo', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  // 1. Fluxo feliz: admin com o segredo certo conecta, a conexao nasce nas
  // duas tabelas e o select da propria conexao funciona (grant + policy).
  it('conectar_whatsapp com segredo certo e admin legitimo grava conexao e credencial, e o admin le a propria conexao', async () => {
    const connectionId = await conectarA(c)
    expect(connectionId).toBeTruthy()

    const linha = await comoServico(async (cli) => {
      const r = await cli.query(
        `select numero_exibicao, nome_verificado from public.whatsapp_connections where id = $1`,
        [connectionId],
      )
      return r.rows[0]
    })
    expect(linha.numero_exibicao).toBe('+55 11 90000-0001')
    expect(linha.nome_verificado).toBe('SE7E Trafego')

    const credencial = await comoServico(async (cli) => {
      const r = await cli.query(
        `select token from public.whatsapp_credentials where connection_id = $1`,
        [connectionId],
      )
      return r.rows[0]
    })
    expect(credencial.token).toBe(TOKEN)

    const vistaPeloAdmin = await comoUsuario(c.adminId, async (cli) => {
      const r = await cli.query('select * from public.whatsapp_connections where id = $1', [
        connectionId,
      ])
      return r.rows
    })
    expect(vistaPeloAdmin).toHaveLength(1)
  })

  // 2. Segredo errado recusa as tres RPCs com segredo_invalido e nada muda —
  // o primeiro portao da 0012, replicado aqui.
  it('segredo errado recusa as tres RPCs com segredo_invalido e nada muda', async () => {
    await expect(
      comoUsuario(c.adminId, (cli) =>
        cli.query('select public.conectar_whatsapp($1, $2, $3, $4, $5, $6, $7)', [
          ERRADO,
          c.accountId,
          'phone-2a',
          'waba-2a',
          '+55 11 90000-0002',
          'Nome 2a',
          TOKEN,
        ]),
      ),
    ).rejects.toThrow(/segredo_invalido/)
    const nenhumaLinha = await comoServico(async (cli) => {
      const r = await cli.query<{ n: string }>(
        `select (select count(*) from public.whatsapp_connections)
              + (select count(*) from public.whatsapp_credentials) as n`,
      )
      return r.rows[0].n
    })
    expect(nenhumaLinha).toBe('0')

    // Conexao existente para exercitar desconectar/credencial com segredo errado.
    const connectionId = await conectarA(c)

    await expect(
      comoUsuario(c.adminId, (cli) =>
        cli.query('select public.desconectar_whatsapp($1, $2)', [ERRADO, connectionId]),
      ),
    ).rejects.toThrow(/segredo_invalido/)

    await expect(
      comoServico((cli) =>
        cli.query('select public.credencial_whatsapp($1, $2)', [ERRADO, c.accountId]),
      ),
    ).rejects.toThrow(/segredo_invalido/)

    const aindaLa = await comoServico(async (cli) => {
      const r = await cli.query('select id from public.whatsapp_connections where id = $1', [
        connectionId,
      ])
      return r.rows
    })
    expect(aindaLa).toHaveLength(1)
  })

  // 3. Com o segredo certo, sessao e papel continuam sendo checados —
  // cumulativos, nao alternativos. Assimetria deliberada com credencial_whatsapp
  // (caso 8), que nao exige sessao nenhuma.
  it('com segredo certo, sem sessao levanta sem_sessao e sem ser admin levanta sem_permissao, em conectar e desconectar', async () => {
    await expect(
      comoServico((cli) =>
        cli.query('select public.conectar_whatsapp($1, $2, $3, $4, $5, $6, $7)', [
          SEGREDO,
          c.accountId,
          'phone-3a',
          'waba-3a',
          '+55 11 90000-0003',
          'Nome 3a',
          TOKEN,
        ]),
      ),
    ).rejects.toThrow(/sem_sessao/)

    await expect(
      comoUsuario(c.vendedorAId, (cli) =>
        cli.query('select public.conectar_whatsapp($1, $2, $3, $4, $5, $6, $7)', [
          SEGREDO,
          c.accountId,
          'phone-3b',
          'waba-3b',
          '+55 11 90000-0004',
          'Nome 3b',
          TOKEN,
        ]),
      ),
    ).rejects.toThrow(/sem_permissao/)

    const nenhumaLinha = await comoServico(async (cli) => {
      const r = await cli.query<{ n: string }>(
        `select (select count(*) from public.whatsapp_connections)
              + (select count(*) from public.whatsapp_credentials) as n`,
      )
      return r.rows[0].n
    })
    expect(nenhumaLinha).toBe('0')

    const connectionId = await conectarA(c)

    await expect(
      comoServico((cli) =>
        cli.query('select public.desconectar_whatsapp($1, $2)', [SEGREDO, connectionId]),
      ),
    ).rejects.toThrow(/sem_sessao/)

    await expect(
      comoUsuario(c.vendedorAId, (cli) =>
        cli.query('select public.desconectar_whatsapp($1, $2)', [SEGREDO, connectionId]),
      ),
    ).rejects.toThrow(/sem_permissao/)

    const aindaLa = await comoServico(async (cli) => {
      const r = await cli.query('select id from public.whatsapp_connections where id = $1', [
        connectionId,
      ])
      return r.rows
    })
    expect(aindaLa).toHaveLength(1)
  })

  // 4. whatsapp_ja_conectado: conta A ja conectada tenta um segundo numero —
  // recusa, e a conexao original fica intacta.
  it('conectar_whatsapp com a conta ja conectada e um segundo numero levanta whatsapp_ja_conectado e nao mexe na conexao original', async () => {
    await conectarA(c)

    await expect(
      comoUsuario(c.adminId, (cli) =>
        cli.query('select public.conectar_whatsapp($1, $2, $3, $4, $5, $6, $7)', [
          SEGREDO,
          c.accountId,
          'phone-a-2',
          'waba-a-2',
          '+55 11 90000-0005',
          'Outro nome',
          'outro-token',
        ]),
      ),
    ).rejects.toThrow(/whatsapp_ja_conectado/)

    const linha = await comoServico(async (cli) => {
      const wc = await cli.query(
        `select phone_number_id from public.whatsapp_connections where account_id = $1`,
        [c.accountId],
      )
      const cr = await cli.query(
        `select cr.token from public.whatsapp_credentials cr
           join public.whatsapp_connections wc on wc.id = cr.connection_id
          where wc.account_id = $1`,
        [c.accountId],
      )
      return { conexoes: wc.rows, token: cr.rows[0].token }
    })
    expect(linha.conexoes).toHaveLength(1)
    expect(linha.conexoes[0].phone_number_id).toBe('phone-a-1')
    expect(linha.token).toBe(TOKEN)
  })

  // 5. numero_ja_conectado: conta B tenta o mesmo numero da conta A — recusa,
  // linha da conta A intacta. Casos 4 e 5 juntos provam que os dois indices
  // unicos sao distinguidos, nao colapsados no mesmo codigo.
  it('conectar_whatsapp com o mesmo numero de outra conta levanta numero_ja_conectado e nao mexe na conexao da conta A', async () => {
    await conectarA(c)
    const outra = await outraContaComAdmin('Conta B', 'b-0019@b.com')

    await expect(
      comoUsuario(outra.adminId, (cli) =>
        cli.query('select public.conectar_whatsapp($1, $2, $3, $4, $5, $6, $7)', [
          SEGREDO,
          outra.accountId,
          'phone-a-1',
          'waba-b-1',
          '+55 11 90000-0006',
          'Nome B',
          'token-b',
        ]),
      ),
    ).rejects.toThrow(/numero_ja_conectado/)

    const linha = await comoServico(async (cli) => {
      const r = await cli.query(
        `select account_id, phone_number_id from public.whatsapp_connections where phone_number_id = 'phone-a-1'`,
      )
      return r.rows
    })
    expect(linha).toHaveLength(1)
    expect(linha[0].account_id).toBe(c.accountId)
  })

  // 6. whatsapp_campos_vazios: token so de espaco recusa, nada gravado. Um
  // campo basta — o if e um so.
  it('conectar_whatsapp com token so de espaco levanta whatsapp_campos_vazios e nao grava nada', async () => {
    await expect(
      comoUsuario(c.adminId, (cli) =>
        cli.query('select public.conectar_whatsapp($1, $2, $3, $4, $5, $6, $7)', [
          SEGREDO,
          c.accountId,
          'phone-6',
          'waba-6',
          '+55 11 90000-0007',
          'Nome 6',
          '   ',
        ]),
      ),
    ).rejects.toThrow(/whatsapp_campos_vazios/)

    const nenhumaLinha = await comoServico(async (cli) => {
      const r = await cli.query<{ n: string }>(
        `select (select count(*) from public.whatsapp_connections)
              + (select count(*) from public.whatsapp_credentials) as n`,
      )
      return r.rows[0].n
    })
    expect(nenhumaLinha).toBe('0')
  })

  // 7. Isolamento no desconectar: mesma matriz do desconectar_fonte (0008).
  it('desconectar_whatsapp: admin de outra conta e vendedor da propria conta levam sem_permissao com a linha intacta; id inexistente leva whatsapp_nao_encontrado', async () => {
    const connectionId = await conectarA(c)
    const outra = await outraContaComAdmin('Conta B', 'b2-0019@b.com')

    await expect(
      comoUsuario(outra.adminId, (cli) =>
        cli.query('select public.desconectar_whatsapp($1, $2)', [SEGREDO, connectionId]),
      ),
    ).rejects.toThrow(/sem_permissao/)

    await expect(
      comoUsuario(c.vendedorAId, (cli) =>
        cli.query('select public.desconectar_whatsapp($1, $2)', [SEGREDO, connectionId]),
      ),
    ).rejects.toThrow(/sem_permissao/)

    const aindaLa = await comoServico(async (cli) => {
      const r = await cli.query('select id from public.whatsapp_connections where id = $1', [
        connectionId,
      ])
      return r.rows
    })
    expect(aindaLa).toHaveLength(1)

    await expect(
      comoUsuario(c.adminId, (cli) =>
        cli.query('select public.desconectar_whatsapp($1, $2)', [
          SEGREDO,
          '00000000-0000-0000-0000-000000000000',
        ]),
      ),
    ).rejects.toThrow(/whatsapp_nao_encontrado/)
  })

  // 8. credencial_whatsapp e o contrato do servidor: segredo certo e SEM
  // sessao nenhuma devolve token/phone_number_id/waba_id. Deliberadamente sem
  // check de sessao — quem chama e o servidor do disparo.
  it('credencial_whatsapp com segredo certo e sem sessao devolve token, phone_number_id e waba_id; sem conexao devolve whatsapp_nao_encontrado', async () => {
    await conectarA(c)

    const credencial = await comoServico(async (cli) => {
      const r = await cli.query(
        'select token, phone_number_id, waba_id from public.credencial_whatsapp($1, $2)',
        [SEGREDO, c.accountId],
      )
      return r.rows[0]
    })
    expect(credencial.token).toBe(TOKEN)
    expect(credencial.phone_number_id).toBe('phone-a-1')
    expect(credencial.waba_id).toBe('waba-a-1')

    const outra = await outraContaComAdmin('Conta B', 'b3-0019@b.com')
    await expect(
      comoServico((cli) =>
        cli.query('select public.credencial_whatsapp($1, $2)', [SEGREDO, outra.accountId]),
      ),
    ).rejects.toThrow(/whatsapp_nao_encontrado/)
  })

  // 9. A credencial e inalcancavel por sessao: permission denied, nao zero
  // linhas. Insert direto na tabela de conexoes tambem falha — o grant e so
  // de select.
  it('whatsapp_credentials e inalcancavel por sessao (permission denied), e insert direto em whatsapp_connections tambem falha', async () => {
    await conectarA(c)

    await expect(
      comoUsuario(c.adminId, (cli) => cli.query('select * from public.whatsapp_credentials')),
    ).rejects.toThrow(/permission denied/i)

    await expect(
      comoUsuario(c.adminId, (cli) =>
        cli.query(
          `insert into public.whatsapp_connections
             (account_id, phone_number_id, waba_id, numero_exibicao, nome_verificado)
           values ($1, 'phone-9', 'waba-9', '+55 11 90000-0009', 'Nome 9')`,
          [c.accountId],
        ),
      ),
    ).rejects.toThrow(/permission denied/i)
  })

  // 10. definer e o desenho (Global Constraints): sem grant nas tabelas,
  // invoker nao alcancaria nada.
  it('as tres RPCs sao security definer (prosecdef = true)', async () => {
    const linhas = await comoServico(async (cli) => {
      const r = await cli.query<{ proname: string; prosecdef: boolean }>(
        `select proname, prosecdef from pg_proc
          where proname in ('conectar_whatsapp', 'desconectar_whatsapp', 'credencial_whatsapp')`,
      )
      return r.rows
    })
    expect(linhas).toHaveLength(3)
    for (const linha of linhas) {
      expect(linha.prosecdef).toBe(true)
    }
  })
})
