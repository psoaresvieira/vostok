import { describe, it, expect, vi, beforeEach } from 'vitest'

const souDonoDaPlataforma = vi.fn()
const contasDaPlataforma = vi.fn()
vi.mock('@/lib/data/plataforma', () => ({
  souDonoDaPlataforma: () => souDonoDaPlataforma(),
  contasDaPlataforma: () => contasDaPlataforma(),
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
}))

import AdminPage from './page'

beforeEach(() => {
  souDonoDaPlataforma.mockReset()
  contasDaPlataforma.mockReset()
})

describe('AdminPage', () => {
  it('devolve 404 para quem nao e o dono: a pagina nem revela que existe', async () => {
    souDonoDaPlataforma.mockResolvedValue(false)
    await expect(AdminPage()).rejects.toThrow('NOT_FOUND')
    expect(contasDaPlataforma).not.toHaveBeenCalled()
  })

  it('renderiza para o dono', async () => {
    souDonoDaPlataforma.mockResolvedValue(true)
    contasDaPlataforma.mockResolvedValue({ ok: true, valor: [] })
    await expect(AdminPage()).resolves.toBeTruthy()
  })
})
