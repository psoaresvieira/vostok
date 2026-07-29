import { describe, it, expect } from 'vitest'
import { chamarAcao, FALHA_DE_CONEXAO } from './acao'
import { ok, falha } from '@/lib/domain/resultado'

describe('chamarAcao', () => {
  it('devolve o sucesso intacto', async () => {
    expect(await chamarAcao(Promise.resolve(ok(7)))).toEqual({ ok: true, valor: 7 })
  })

  it('devolve a falha do servidor intacta, sem trocar o codigo', async () => {
    expect(await chamarAcao(Promise.resolve(falha('etapa_invalida')))).toEqual({
      ok: false,
      erro: 'etapa_invalida',
    })
  })

  it('converte rejeicao de transporte em falha com codigo', async () => {
    const r = await chamarAcao(Promise.reject(new TypeError('Failed to fetch')))
    expect(r).toEqual({ ok: false, erro: FALHA_DE_CONEXAO })
  })

  it('nao deixa a rejeicao escapar', async () => {
    await expect(chamarAcao(Promise.reject(new Error('boom')))).resolves.toBeDefined()
  })
})
