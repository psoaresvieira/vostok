import { describe, it, expect, beforeEach } from 'vitest'
import { SupabaseNotificacaoStore } from '@/lib/data/notificacoes'
import { comoServico, limparBanco } from './helpers/db'
import { clienteDoUsuario } from './helpers/cliente'
import { montarCenario, criarLead, etapa, type Cenario } from './helpers/cenario'

/** Insere a notificacao direto (como servico): notifications nao tem grant de
 * insert para authenticated (0009) — so as funcoes de ingestao escrevem la —
 * entao o teste precisa da mesma porta de servico que o insere na producao. */
async function inserirNotificacao(
  accountId: string,
  usuarioId: string,
  leadId: string,
  tipo: 'novo_lead' | 'lead_reincidente' = 'novo_lead',
): Promise<string> {
  return comoServico(async (cli) => {
    const r = await cli.query<{ id: string }>(
      `insert into public.notifications (account_id, usuario_id, lead_id, tipo)
       values ($1, $2, $3, $4) returning id`,
      [accountId, usuarioId, leadId, tipo],
    )
    return r.rows[0].id
  })
}

describe('SupabaseNotificacaoStore', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  it('vendedor lista so as proprias notificacoes, com o nome do lead junto', async () => {
    const leadA = await criarLead(c, 'Lead do A', c.vendedorAId, etapa(c, 'Novo lead'))
    const leadB = await criarLead(c, 'Lead do B', c.vendedorBId, etapa(c, 'Novo lead'))
    await inserirNotificacao(c.accountId, c.vendedorAId, leadA)
    await inserirNotificacao(c.accountId, c.vendedorBId, leadB)

    const cliente = await clienteDoUsuario(c.vendedorAId)
    const store = new SupabaseNotificacaoStore(cliente)

    const r = await store.listar(20)
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor).toHaveLength(1)
    expect(r.valor[0].leadId).toBe(leadA)
    expect(r.valor[0].leadNome).toBe('Lead do A')
    expect(r.valor[0].tipo).toBe('novo_lead')
    expect(r.valor[0].lidaEm).toBeNull()
  })

  it('vendedor B nao ve nem consegue marcar como lida a notificacao de A', async () => {
    const leadA = await criarLead(c, 'Lead do A', c.vendedorAId, etapa(c, 'Novo lead'))
    const notifId = await inserirNotificacao(c.accountId, c.vendedorAId, leadA)

    const clienteB = await clienteDoUsuario(c.vendedorBId)
    const storeB = new SupabaseNotificacaoStore(clienteB)

    const lista = await storeB.listar(20)
    if (!lista.ok) throw new Error(lista.erro)
    expect(lista.valor).toEqual([])

    const marcou = await storeB.marcarLida(notifId)
    expect(marcou.ok).toBe(false)

    // Continua nao lida na origem — a tentativa de B nao mudou nada.
    const linha = await comoServico(async (cli) => {
      const r = await cli.query<{ lida_em: string | null }>(
        'select lida_em from public.notifications where id = $1',
        [notifId],
      )
      return r.rows[0]
    })
    expect(linha.lida_em).toBeNull()
  })

  it('naoLidas conta so as de lida_em nulo do proprio usuario', async () => {
    const leadA1 = await criarLead(c, 'Lead 1', c.vendedorAId, etapa(c, 'Novo lead'))
    const leadA2 = await criarLead(c, 'Lead 2', c.vendedorAId, etapa(c, 'Novo lead'))
    const leadB = await criarLead(c, 'Lead do B', c.vendedorBId, etapa(c, 'Novo lead'))
    const lida = await inserirNotificacao(c.accountId, c.vendedorAId, leadA1)
    await inserirNotificacao(c.accountId, c.vendedorAId, leadA2)
    await inserirNotificacao(c.accountId, c.vendedorBId, leadB)
    await comoServico((cli) =>
      cli.query('update public.notifications set lida_em = now() where id = $1', [lida]),
    )

    const cliente = await clienteDoUsuario(c.vendedorAId)
    const store = new SupabaseNotificacaoStore(cliente)

    const r = await store.naoLidas()
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor).toBe(1)
  })

  it('marcarLida carimba lida_em e e idempotente', async () => {
    const leadA = await criarLead(c, 'Lead do A', c.vendedorAId, etapa(c, 'Novo lead'))
    const notifId = await inserirNotificacao(c.accountId, c.vendedorAId, leadA)

    const cliente = await clienteDoUsuario(c.vendedorAId)
    const store = new SupabaseNotificacaoStore(cliente)

    const primeira = await store.marcarLida(notifId)
    expect(primeira.ok).toBe(true)

    const linha = await comoServico(async (cli) => {
      const r = await cli.query<{ lida_em: string | null }>(
        'select lida_em from public.notifications where id = $1',
        [notifId],
      )
      return r.rows[0]
    })
    expect(linha.lida_em).not.toBeNull()

    // Segunda chamada sobre uma notificacao ja lida: continua um sucesso, nao
    // um erro — e o que "idempotente" quer dizer aqui.
    const segunda = await store.marcarLida(notifId)
    expect(segunda.ok).toBe(true)
  })

  it('marcarTodasLidas nao toca notificacao de outro usuario', async () => {
    const leadA = await criarLead(c, 'Lead do A', c.vendedorAId, etapa(c, 'Novo lead'))
    const leadB = await criarLead(c, 'Lead do B', c.vendedorBId, etapa(c, 'Novo lead'))
    const notifA = await inserirNotificacao(c.accountId, c.vendedorAId, leadA)
    const notifB = await inserirNotificacao(c.accountId, c.vendedorBId, leadB)

    const clienteB = await clienteDoUsuario(c.vendedorBId)
    const storeB = new SupabaseNotificacaoStore(clienteB)

    const r = await storeB.marcarTodasLidas()
    expect(r.ok).toBe(true)

    const linhas = await comoServico(async (cli) => {
      const res = await cli.query<{ id: string; lida_em: string | null }>(
        'select id, lida_em from public.notifications where id = any($1)',
        [[notifA, notifB]],
      )
      return res.rows
    })
    const porId = new Map(linhas.map((l) => [l.id, l.lida_em]))
    expect(porId.get(notifA)).toBeNull()
    expect(porId.get(notifB)).not.toBeNull()
  })
})
