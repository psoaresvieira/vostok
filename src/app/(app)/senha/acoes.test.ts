import { describe, it, expect, vi, beforeEach } from 'vitest'
import { trocarSenha } from './acoes'

// Mock file-scoped de @/lib/supabase/servidor, mesmo arranjo de
// (auth)/acoes-cadastro.test.ts: o double devolve um cliente cujo
// updateUser cada teste configura.
const updateUser = vi.fn()
vi.mock('@/lib/supabase/servidor', () => ({
  criarClienteServidor: vi.fn(async () => ({ auth: { updateUser } })),
}))

beforeEach(() => {
  updateUser.mockReset()
})

function formulario(senha = 'segredo123', confirmacao = 'segredo123'): FormData {
  const fd = new FormData()
  fd.set('senha', senha)
  fd.set('confirmacao', confirmacao)
  return fd
}

describe('trocarSenha', () => {
  it('sucesso devolve ok', async () => {
    updateUser.mockResolvedValue({ error: null })
    const r = await trocarSenha(formulario())
    expect(r).toEqual({ ok: true, valor: undefined })
  })

  it('same_password vira senha_igual', async () => {
    // Variante do code estruturado: a API estavel do GoTrue.
    updateUser.mockResolvedValue({ error: { code: 'same_password', message: 'texto qualquer' } })
    const r1 = await trocarSenha(formulario())
    expect(r1).toEqual({ ok: false, erro: 'senha_igual' })

    // Variante so-mensagem: sem code, so o texto reescrito do GoTrue.
    updateUser.mockResolvedValue({
      error: { message: 'New password should be different from the old password.' },
    })
    const r2 = await trocarSenha(formulario())
    expect(r2).toEqual({ ok: false, erro: 'senha_igual' })
  })

  it('mensagem de sessao ausente ou expirada vira sem_sessao', async () => {
    updateUser.mockResolvedValue({ error: { message: 'Auth session missing!' } })
    const r = await trocarSenha(formulario())
    expect(r).toEqual({ ok: false, erro: 'sem_sessao' })
  })

  it('erro desconhecido vira erro_ao_trocar_senha, nunca a mensagem crua', async () => {
    updateUser.mockResolvedValue({ error: { message: 'Database error saving new password' } })
    const r = await trocarSenha(formulario())
    expect(r).toEqual({ ok: false, erro: 'erro_ao_trocar_senha' })
  })

  it('schema invalido nem toca o supabase', async () => {
    const r = await trocarSenha(formulario('123', '123'))
    expect(r).toEqual({ ok: false, erro: 'senha_curta' })
    expect(updateUser).not.toHaveBeenCalled()
  })
})
