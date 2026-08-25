import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mensagemDeErro } from './erros'
import { cadastrar, aceitarConvite } from './acoes'

// Mock proprio, separado de acoes.test.ts: la o criarClienteServidor LANCA de
// proposito (prova que cadastro fechado nao toca o supabase). Aqui o cadastro
// COM convite precisa chegar ao signUp, entao o double devolve um cliente cujo
// comportamento cada teste configura.
const signUp = vi.fn()
const rpc = vi.fn()
vi.mock('@/lib/supabase/servidor', () => ({
  criarClienteServidor: vi.fn(async () => ({ auth: { signUp }, rpc })),
}))

beforeEach(() => {
  signUp.mockReset()
  rpc.mockReset()
})

function formulario(): FormData {
  const fd = new FormData()
  fd.set('nome', 'Ana')
  fd.set('email', 'ana@exemplo.com')
  fd.set('senha', 'segredo123')
  fd.set('convite', 'tok123')
  return fd
}

describe('cadastrar com convite — erro do signUp nunca chega cru na tela', () => {
  it('traduz "User already registered" em email_ja_cadastrado', async () => {
    signUp.mockResolvedValue({ data: { session: null }, error: { message: 'User already registered' } })
    const r = await cadastrar(formulario())
    expect(r).toEqual({ ok: false, erro: 'email_ja_cadastrado' })
  })

  it('normaliza qualquer outro erro do signUp para cadastro_indisponivel', async () => {
    signUp.mockResolvedValue({
      data: { session: null },
      error: { message: 'Database error saving new user' },
    })
    const r = await cadastrar(formulario())
    expect(r).toEqual({ ok: false, erro: 'cadastro_indisponivel' })
  })

  it('traduz o code estruturado user_already_exists mesmo com a mensagem reescrita', async () => {
    // A mensagem do GoTrue nao e' versionada; o code e'. Um upgrade que
    // reescreva o texto nao pode rebaixar o erro para o generico.
    signUp.mockResolvedValue({
      data: { session: null },
      error: { code: 'user_already_exists', message: 'texto novo qualquer' },
    })
    const r = await cadastrar(formulario())
    expect(r).toEqual({ ok: false, erro: 'email_ja_cadastrado' })
  })

  it('signUp sem sessao (confirmacao de email ligada) vira confirmacao_pendente sem tocar o accept_invite', async () => {
    signUp.mockResolvedValue({
      data: { session: null, user: { identities: [{ id: 'id-1' }] } },
      error: null,
    })
    const r = await cadastrar(formulario())
    expect(r).toEqual({ ok: false, erro: 'confirmacao_pendente' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('com confirmacao ligada, email ja registrado (user ofuscado, identities vazio) vira email_ja_cadastrado, nao confirmacao_pendente', async () => {
    // Anti-enumeracao do GoTrue: signUp de email existente com confirmacao
    // ligada devolve SUCESSO com user ofuscado (identities: []) e sem sessao.
    // Sem esta guarda, o convidado que ja tem conta receberia "confirme seu
    // email" — e o email nunca chega.
    signUp.mockResolvedValue({
      data: { session: null, user: { identities: [] } },
      error: null,
    })
    const r = await cadastrar(formulario())
    expect(r).toEqual({ ok: false, erro: 'email_ja_cadastrado' })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('aceitarConvite — erro desconhecido do accept_invite nunca chega cru', () => {
  it('normaliza mensagem crua do Postgres para erro_ao_aceitar_convite', async () => {
    rpc.mockResolvedValue({ error: { message: 'permission denied for table invites' } })
    const r = await aceitarConvite('tok123')
    expect(r).toEqual({ ok: false, erro: 'erro_ao_aceitar_convite' })
  })

  it('codigos conhecidos continuam passando inalterados', async () => {
    rpc.mockResolvedValue({ error: { message: 'convite_expirado (raise exception)' } })
    const r = await aceitarConvite('tok123')
    expect(r).toEqual({ ok: false, erro: 'convite_expirado' })
  })
})

describe('mensagemDeErro dos codigos novos do cadastro', () => {
  it.each([
    'email_ja_cadastrado',
    'confirmacao_pendente',
    'cadastro_indisponivel',
    'erro_ao_aceitar_convite',
  ])('%s tem traducao propria, nao ecoa o codigo', (codigo) => {
    expect(mensagemDeErro(codigo)).not.toBe(codigo)
  })
})
