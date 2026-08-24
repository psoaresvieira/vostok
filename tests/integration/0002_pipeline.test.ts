import { describe, it, expect, beforeEach } from 'vitest'
import { comoServico, comoUsuario, criarUsuario, limparBanco } from './helpers/db'
import { criarContaAvulsa } from './helpers/cenario'

describe('0002 — pipeline e criacao de conta', () => {
  beforeEach(limparBanco)

  it('criar_conta faz o seed completo e torna o chamador admin', async () => {
    const ana = await criarUsuario('ana@a.com')

    const accountId = await criarContaAvulsa(ana, 'Empresa Exemplo')

    const dados = await comoServico(async (c) => ({
      papel: (
        await c.query('select papel from public.memberships where account_id = $1', [accountId])
      ).rows[0].papel,
      etapas: (
        await c.query(
          `select s.nome, s.ordem, s.tipo from public.stages s
           join public.pipelines p on p.id = s.pipeline_id
           where p.account_id = $1 order by s.ordem`,
          [accountId],
        )
      ).rows,
      motivos: (
        await c.query('select count(*)::int as n from public.loss_reasons where account_id = $1', [
          accountId,
        ])
      ).rows[0].n,
      pipelinePadrao: (
        await c.query('select is_default from public.pipelines where account_id = $1', [accountId])
      ).rows[0].is_default,
    }))

    expect(dados.papel).toBe('admin')
    expect(dados.pipelinePadrao).toBe(true)
    expect(dados.motivos).toBe(5)
    expect(dados.etapas.map((e) => e.nome)).toEqual([
      'Novo lead',
      'Contato feito',
      'Qualificação',
      'Proposta',
      'Fechamento',
      'Ganho',
      'Perdido',
    ])
    expect(dados.etapas.map((e) => e.tipo)).toEqual([
      'aberta',
      'aberta',
      'aberta',
      'aberta',
      'aberta',
      'ganho',
      'perdido',
    ])
  })

  it('criar_conta sem sessao falha', async () => {
    // comoServico nao seta request.jwt.claims, entao auth.uid() e null.
    await expect(
      comoServico((c) => c.query('select public.criar_conta($1)', ['Sem dono'])),
    ).rejects.toThrow(/sem_sessao/)
  })

  it('etapas de uma conta nao sao visiveis por outra', async () => {
    const ana = await criarUsuario('ana@a.com')
    const bruno = await criarUsuario('bruno@b.com')
    await criarContaAvulsa(ana, 'Conta A')
    await criarContaAvulsa(bruno, 'Conta B')

    const doBruno = await comoUsuario(bruno, async (c) =>
      (await c.query('select nome from public.pipelines')).rows,
    )
    expect(doBruno).toHaveLength(1)
    expect(doBruno[0].nome).toBe('Funil de vendas')

    const etapasVistas = await comoUsuario(bruno, async (c) =>
      (await c.query('select count(*)::int as n from public.stages')).rows[0].n,
    )
    expect(etapasVistas).toBe(7)
  })

  it('vendedor da mesma conta altera etapas, admin de outra conta nao', async () => {
    // Migration 0025 (Plano 14) revogou o admin-only da policy de stages:
    // qualquer membro da conta agora escreve. O caso que sobrevive e o de
    // isolamento entre contas, nao mais o de papel dentro da conta.
    const ana = await criarUsuario('ana@a.com')
    const vendedor = await criarUsuario('v@a.com')
    const accountId = await criarContaAvulsa(ana, 'Empresa Exemplo')
    await comoServico((c) =>
      c.query(
        `insert into public.memberships (account_id, user_id, papel) values ($1, $2, 'vendedor')`,
        [accountId, vendedor],
      ),
    )

    const alteradasPeloVendedor = await comoUsuario(vendedor, async (c) =>
      (await c.query(`update public.stages set nome = 'Novo contato' where ordem = 1`)).rowCount,
    )
    expect(alteradasPeloVendedor).toBe(1)

    const stageDaContaA = await comoServico(async (c) =>
      (
        await c.query<{ id: string }>(
          `select s.id from public.stages s
           join public.pipelines p on p.id = s.pipeline_id
           where p.account_id = $1 and s.ordem = 1`,
          [accountId],
        )
      ).rows[0].id,
    )

    const outroAdmin = await criarUsuario('outro-admin@b.com')
    await criarContaAvulsa(outroAdmin, 'Conta B')
    const alteradasPeloOutroAdmin = await comoUsuario(outroAdmin, async (c) =>
      (await c.query(`update public.stages set nome = 'Hackeada' where id = $1`, [stageDaContaA]))
        .rowCount,
    )
    expect(alteradasPeloOutroAdmin).toBe(0)
  })
})
