import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Unidade, na forma de acoes-fontes.test.ts: store mockado por vi.mock,
 * duplo real do Graph (WhatsAppGraphFalso, via whatsappFalso()) para provar
 * o encadeamento sem tocar rede nenhuma.
 */

const whatsappStoreMock = {
  atual: vi.fn(),
  conectar: vi.fn(),
  desconectar: vi.fn(),
}

vi.mock('next/cache', () => ({
  revalidatePath: () => {},
}))

const CONTA_ATIVA = { id: 'conta-real', nome: 'Conta Real' }

vi.mock('@/lib/data/whatsapp', () => ({
  criarWhatsAppStoreDoServidor: async () => ({
    ok: true,
    valor: { whatsapp: whatsappStoreMock, conta: CONTA_ATIVA },
  }),
}))

import { whatsappFalso } from '@/lib/integracoes/fabrica'
import { conectarWhatsAppAction } from './acoes-whatsapp'

describe('acoes-whatsapp — conectarWhatsAppAction', () => {
  beforeEach(() => {
    whatsappFalso().reiniciar()
    whatsappStoreMock.conectar.mockReset()
    vi.stubEnv('META_FAKE', '1')
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('INGESTAO_SEGREDO', 'segredo-de-teste')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // 6. Campo vazio falha antes de qualquer IO.
  it('campo vazio falha antes de qualquer IO: consultados do duplo continua vazio', async () => {
    const r = await conectarWhatsAppAction({
      token: '   ',
      phoneNumberId: '1234567890',
      wabaId: 'waba-abc',
    })

    expect(r).toEqual({ ok: false, erro: 'whatsapp_campos_vazios' })
    // Asercao sobre o estado do duplo, nao espionagem: se a validacao rodasse
    // depois da chamada ao Graph, consultados nao estaria vazio.
    expect(whatsappFalso().consultados).toEqual([])
    expect(whatsappStoreMock.conectar).not.toHaveBeenCalled()
  })

  // 7. Token recusado pelo Graph nao grava.
  it('token recusado pelo Graph: devolve token_whatsapp_invalido e nao grava', async () => {
    // Nenhum token em tokensAceitos: a falsa recusa qualquer credencial.
    const r = await conectarWhatsAppAction({
      token: 'token-nunca-aceito',
      phoneNumberId: '1234567890',
      wabaId: 'waba-abc',
    })

    expect(r).toEqual({ ok: false, erro: 'token_whatsapp_invalido' })
    expect(whatsappStoreMock.conectar).not.toHaveBeenCalled()
  })

  // 8. O caso central: o que se grava e o que o Graph devolveu, nunca o formulario.
  it('o que se grava e o que o Graph devolveu, nao o que foi digitado', async () => {
    whatsappFalso().tokensAceitos.add('token-valido')
    whatsappFalso().numeros.set('1234567890', {
      numeroExibicao: '+55 11 99999-9999 (do Graph)',
      nomeVerificado: 'Nome Verificado pelo Graph',
    })
    whatsappStoreMock.conectar.mockResolvedValueOnce({ ok: true, valor: 'conexao-nova' })

    const r = await conectarWhatsAppAction({
      token: 'token-valido',
      phoneNumberId: '1234567890',
      wabaId: 'waba-do-formulario',
    })

    expect(r).toEqual({ ok: true, valor: undefined })
    expect(whatsappStoreMock.conectar).toHaveBeenCalledWith({
      phoneNumberId: '1234567890',
      wabaId: 'waba-do-formulario',
      numeroExibicao: '+55 11 99999-9999 (do Graph)',
      nomeVerificado: 'Nome Verificado pelo Graph',
      token: 'token-valido',
    })
  })

  it('sem INGESTAO_SEGREDO: recusa antes de tocar o Graph', async () => {
    vi.stubEnv('INGESTAO_SEGREDO', '')

    const r = await conectarWhatsAppAction({
      token: 'token-valido',
      phoneNumberId: '1234567890',
      wabaId: 'waba-abc',
    })

    expect(r).toEqual({ ok: false, erro: 'ingestao_nao_configurada' })
    expect(whatsappFalso().consultados).toEqual([])
    expect(whatsappStoreMock.conectar).not.toHaveBeenCalled()
  })
})
