import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
vi.mock('./sessao', () => ({ clienteDoServidor: vi.fn(async () => ({ rpc })) }))

import {
  souDonoDaPlataforma,
  criarContaCliente,
  reemitirConvite,
  contasDaPlataforma,
} from './plataforma'

beforeEach(() => rpc.mockReset())

describe('souDonoDaPlataforma', () => {
  it('true quando a RPC diz true', async () => {
    rpc.mockResolvedValue({ data: true, error: null })
    expect(await souDonoDaPlataforma()).toBe(true)
    expect(rpc).toHaveBeenCalledWith('sou_dono_da_plataforma')
  })

  it('false em erro: guarda nunca abre por falha', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    expect(await souDonoDaPlataforma()).toBe(false)
  })
})

describe('criarContaCliente', () => {
  it('devolve o token e passa nome/email para a RPC', async () => {
    rpc.mockResolvedValue({ data: 'tok123', error: null })
    const r = await criarContaCliente('Cliente X', 'x@x.com')
    expect(r).toEqual({ ok: true, valor: 'tok123' })
    expect(rpc).toHaveBeenCalledWith('criar_conta_cliente', { p_nome: 'Cliente X', p_email: 'x@x.com' })
  })

  it('extrai o codigo de erro da mensagem do postgres', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'ERROR: sem_permissao' } })
    const r = await criarContaCliente('X', 'x@x.com')
    expect(r).toEqual({ ok: false, erro: 'sem_permissao' })
  })
})

describe('reemitirConvite', () => {
  it('traduz convite_ja_aceito', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'P0001 convite_ja_aceito' } })
    expect(await reemitirConvite('id-1')).toEqual({ ok: false, erro: 'convite_ja_aceito' })
  })
})

describe('contasDaPlataforma', () => {
  it('mapeia linhas com e sem convite', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          conta_id: 'c1', nome: 'Cliente A', criado_em: '2026-08-24T12:00:00Z',
          convite_id: 'i1', convite_email: 'a@a.com',
          convite_expira_em: '2026-08-31T12:00:00Z', convite_aceito_em: null,
        },
        {
          conta_id: 'c2', nome: 'Minha Conta', criado_em: '2026-08-01T12:00:00Z',
          convite_id: null, convite_email: null, convite_expira_em: null, convite_aceito_em: null,
        },
      ],
      error: null,
    })
    const r = await contasDaPlataforma()
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor[0].convite?.email).toBe('a@a.com')
    expect(r.valor[0].convite?.aceitoEm).toBeNull()
    expect(r.valor[1].convite).toBeNull()
  })
})
