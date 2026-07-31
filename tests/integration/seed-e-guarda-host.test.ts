import { describe, it, expect } from 'vitest'
import { exigirHostLocal } from './helpers/guarda-host'
import { comoServico } from './helpers/db'

describe('exigirHostLocal', () => {
  it('devolve a string inalterada quando o host e 127.0.0.1', () => {
    const conexao = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
    expect(exigirHostLocal(conexao)).toBe(conexao)
  })

  it('devolve a string inalterada quando o host e localhost', () => {
    const conexao = 'postgresql://postgres:postgres@localhost:54322/postgres'
    expect(exigirHostLocal(conexao)).toBe(conexao)
  })

  it('lanca e nomeia o host recusado quando aponta para um banco remoto', () => {
    const conexao = 'postgresql://user:pw@db.projeto.supabase.co:5432/postgres'
    expect(() => exigirHostLocal(conexao)).toThrow(/db\.projeto\.supabase\.co/)
  })

  it('lanca quando a string nao e uma URL — parse que falha tem que recusar', () => {
    expect(() => exigirHostLocal('isso nao e uma url de conexao')).toThrow()
  })
})

describe('segredo de ingestao semeado', () => {
  it('o hash do segredo de dev bate com segredo_hash em ingestion_config', async () => {
    const bate = await comoServico(async (c) => {
      const r = await c.query<{ bate: boolean }>(
        `select public.hash_segredo('segredo-de-ingestao-local') = segredo_hash as bate
           from public.ingestion_config
          where id`,
      )
      return r.rows[0]?.bate
    })
    expect(bate).toBe(true)
  })
})
