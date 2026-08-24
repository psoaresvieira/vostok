import { describe, it, expect, vi, beforeEach } from 'vitest'

const criarContaCliente = vi.fn()
const reemitirConvite = vi.fn()
vi.mock('@/lib/data/plataforma', () => ({
  criarContaCliente: (...a: unknown[]) => criarContaCliente(...a),
  reemitirConvite: (...a: unknown[]) => reemitirConvite(...a),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { criarContaClienteAction, reemitirConviteAction } from './acoes'

beforeEach(() => {
  criarContaCliente.mockReset()
  reemitirConvite.mockReset()
})

function formulario(nome: string, email: string): FormData {
  const fd = new FormData()
  fd.set('nome', nome)
  fd.set('email', email)
  return fd
}

describe('criarContaClienteAction', () => {
  it('valida antes de chamar a RPC: nome vazio nao passa', async () => {
    const r = await criarContaClienteAction(formulario('  ', 'x@x.com'))
    expect(r).toEqual({ ok: false, erro: 'nome_obrigatorio' })
    expect(criarContaCliente).not.toHaveBeenCalled()
  })

  it('valida o email', async () => {
    const r = await criarContaClienteAction(formulario('Cliente', 'nao-email'))
    expect(r).toEqual({ ok: false, erro: 'email_invalido' })
  })

  it('normaliza o email e devolve o token', async () => {
    criarContaCliente.mockResolvedValue({ ok: true, valor: 'tok123' })
    const r = await criarContaClienteAction(formulario('Cliente X', '  Ana@Ex.com '))
    expect(criarContaCliente).toHaveBeenCalledWith('Cliente X', 'ana@ex.com')
    expect(r).toEqual({ ok: true, valor: 'tok123' })
  })

  it('propaga o codigo de erro da camada de dados', async () => {
    criarContaCliente.mockResolvedValue({ ok: false, erro: 'sem_permissao' })
    const r = await criarContaClienteAction(formulario('Cliente X', 'a@a.com'))
    expect(r).toEqual({ ok: false, erro: 'sem_permissao' })
  })
})

describe('reemitirConviteAction', () => {
  it('recusa id vazio sem tocar a RPC', async () => {
    const r = await reemitirConviteAction('   ')
    expect(r).toEqual({ ok: false, erro: 'convite_invalido' })
    expect(reemitirConvite).not.toHaveBeenCalled()
  })

  it('devolve o token novo', async () => {
    reemitirConvite.mockResolvedValue({ ok: true, valor: 'tok456' })
    expect(await reemitirConviteAction('id-1')).toEqual({ ok: true, valor: 'tok456' })
  })
})
