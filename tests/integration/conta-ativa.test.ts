import { describe, it, expect, beforeEach } from 'vitest'
import { resolverContaAtiva } from '@/lib/data/conta'
import { comoServico, limparBanco, criarUsuario } from './helpers/db'
import { clienteDoUsuario } from './helpers/cliente'
import { montarCenario, type Cenario } from './helpers/cenario'

describe('resolverContaAtiva', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  it('devolve a conta e o papel do proprio usuario', async () => {
    const cliente = await clienteDoUsuario(c.vendedorAId)
    const r = await resolverContaAtiva(cliente, c.vendedorAId)
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor.conta.id).toBe(c.accountId)
    expect(r.valor.papel).toBe('vendedor')
  })

  it('escolhe sempre a membership mais antiga quando ha duas', async () => {
    // Uma segunda conta, criada e inserida FISICAMENTE DEPOIS da membership
    // original de c.adminId, mas com criado_em ANTERIOR a ela. Isso poe ordem
    // fisica (insercao) e ordem cronologica (criado_em) em desacordo de
    // proposito: se o teste so passar por causa da ordem fisica de insercao
    // (o que um heap scan tende a devolver sem order by), tirar o
    // .order('criado_em') da implementacao nao mudaria o resultado e o teste
    // passaria por sorte. Com o desacordo, so o order by pode fazer a conta
    // certa (a mais antiga por criado_em, que e a segunda) vencer sempre.
    const outroAdmin = await criarUsuario('outro@b.com')
    const outraConta = await comoServico(async (cli) => {
      const r = await cli.query<{ id: string }>(
        `insert into public.accounts (nome) values ('Outra') returning id`,
      )
      return r.rows[0].id
    })
    await comoServico((cli) =>
      cli.query(
        `insert into public.memberships (account_id, user_id, papel, criado_em)
         values ($1, $2, 'admin', now() - interval '1 hour'),
                ($1, $3, 'admin', now() - interval '1 hour')`,
        [outraConta, c.adminId, outroAdmin],
      ),
    )

    const cliente = await clienteDoUsuario(c.adminId)

    // Dez resolucoes seguidas: sem order by, o Postgres pode devolver linhas
    // diferentes entre chamadas, entao uma unica assercao passaria por sorte.
    for (let i = 0; i < 10; i++) {
      const r = await resolverContaAtiva(cliente, c.adminId)
      if (!r.ok) throw new Error(r.erro)
      expect(r.valor.conta.id).toBe(outraConta)
    }
  })

  it('falha com sem_conta quando o usuario nao e membro de nada', async () => {
    const solto = await criarUsuario('solto@c.com')
    const cliente = await clienteDoUsuario(solto)
    const r = await resolverContaAtiva(cliente, solto)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('deveria ter falhado')
    expect(r.erro).toBe('sem_conta')
  })
})
