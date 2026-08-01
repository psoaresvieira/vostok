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

  // Achado 8 do review final: a mensagem antiga interpolava a SUPABASE_DB_URL
  // inteira, senha incluida, e essa string aparece em log de CI.
  it('a mensagem de host remoto nunca inclui a senha da string de conexao', () => {
    const conexao = 'postgresql://user:senha-secreta-123@db.projeto.supabase.co:5432/postgres'
    try {
      exigirHostLocal(conexao)
      throw new Error('deveria ter lancado')
    } catch (e) {
      expect(e).toBeInstanceOf(Error)
      expect((e as Error).message).not.toContain('senha-secreta-123')
      expect((e as Error).message).toContain('db.projeto.supabase.co')
    }
  })

  it('a mensagem de parse invalido nunca inclui a string de conexao, e encadeia a causa original', () => {
    const conexao = 'postgresql://user:senha-secreta-456@isso nao e uma url valida'
    try {
      exigirHostLocal(conexao)
      throw new Error('deveria ter lancado')
    } catch (e) {
      expect(e).toBeInstanceOf(Error)
      expect((e as Error).message).not.toContain('senha-secreta-456')
      expect((e as Error).cause).toBeInstanceOf(Error)
    }
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
