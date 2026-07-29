import { describe, it, expect, beforeEach } from 'vitest'
import { comoServico, limparBanco } from './helpers/db'
import { clienteDoUsuario } from './helpers/cliente'
import { montarCenario, etapa, criarLead, type Cenario } from './helpers/cenario'
import { SupabaseCrmStore } from '@/lib/data/supabase'

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

  it('busca trata porcento digitado como literal', async () => {
    const cliente = await clienteDoUsuario(c.adminId)
    const store = new SupabaseCrmStore(cliente, c.accountId, c.adminId)
    await criarLead(c, 'Desconto 100%', c.adminId, etapa(c, 'Novo lead'))
    await criarLead(c, 'Desconto 1000 leads', c.adminId, etapa(c, 'Novo lead'))

    const r = await store.listarLeads({ busca: '100%' })
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor.map((l) => l.nome)).toEqual(['Desconto 100%'])
  })

  it('busca com virgula nao abre condicao OR extra', async () => {
    const cliente = await clienteDoUsuario(c.adminId)
    const store = new SupabaseCrmStore(cliente, c.accountId, c.adminId)
    await criarLead(c, 'Silva, Joao', c.adminId, etapa(c, 'Novo lead'))
    await criarLead(c, 'Pereira', c.adminId, etapa(c, 'Novo lead'))

    const r = await store.listarLeads({ busca: 'Silva, Joao' })
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor.map((l) => l.nome)).toEqual(['Silva, Joao'])
  })

  it('email com virgula nao quebra a busca de duplicados', async () => {
    const cliente = await clienteDoUsuario(c.adminId)
    const store = new SupabaseCrmStore(cliente, c.accountId, c.adminId)
    const r = await store.possiveisDuplicados(null, 'a,b@x.com')
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor).toEqual([])
  })
})
