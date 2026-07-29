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

  it('escolhe a membership mais antiga entre muitas concorrentes, nao a primeira por ordem fisica', async () => {
    // Com so duas candidatas (versao anterior deste teste), acertar a
    // vencedora por acaso sem o order by tinha uma chance alta demais: rodando
    // o processo do zero 5 vezes, o resultado so divergiu em 2 delas. Uma
    // regressao real passaria batido na maioria das rodadas de CI. Com ~50
    // candidatas a chance de acertar a vencedora por sorte cai para ~1/50.
    //
    // 49 contas concorrentes, inseridas PRIMEIRO (fisicamente antes de tudo o
    // mais neste teste), todas com criado_em = now().
    const N_CONCORRENTES = 49
    const concorrentes = await comoServico(async (cli) => {
      const r = await cli.query<{ id: string }>(
        `insert into public.accounts (nome)
         select 'Concorrente ' || gs from generate_series(1, $1) gs
         returning id`,
        [N_CONCORRENTES],
      )
      return r.rows.map((row) => row.id)
    })
    await comoServico((cli) =>
      cli.query(
        `insert into public.memberships (account_id, user_id, papel, criado_em)
         select unnest($1::uuid[]), $2, 'admin', now()`,
        [concorrentes, c.adminId],
      ),
    )

    // A vencedora e inserida por ULTIMO fisicamente — depois de todas as 49
    // concorrentes acima e da membership original de c.adminId (criada no
    // cenario, no inicio do teste) — mas com o criado_em mais antigo de todas.
    // So o order by pode fazer essa linha, a ultima em ordem fisica, vencer.
    const vencedora = await comoServico(async (cli) => {
      const r = await cli.query<{ id: string }>(
        `insert into public.accounts (nome) values ('Vencedora') returning id`,
      )
      return r.rows[0].id
    })
    await comoServico((cli) =>
      cli.query(
        `insert into public.memberships (account_id, user_id, papel, criado_em)
         values ($1, $2, 'admin', now() - interval '1 hour')`,
        [vencedora, c.adminId],
      ),
    )

    const cliente = await clienteDoUsuario(c.adminId)

    // Uma chamada so, sem loop: dentro de uma mesma execucao, com o mesmo
    // estado de banco, chamadas repetidas devolveram sempre o mesmo resultado
    // nos testes empiricos (ver task-2-report.md) — a variacao apareceu entre
    // execucoes do vitest, cada uma com o banco recriado do zero, nunca entre
    // chamadas sucessivas dentro da mesma execucao. Um loop aqui nao
    // acrescentaria protecao real; quem prova a sensibilidade do teste e rodar
    // a suite inteira varias vezes (ver relatorio), nao repetir a chamada.
    const r = await resolverContaAtiva(cliente, c.adminId)
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor.conta.id).toBe(vencedora)
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
