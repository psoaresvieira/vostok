import { describe, it, expect, beforeEach } from 'vitest'
import { comoUsuario, criarUsuario, limparBanco, tornarDono } from './helpers/db'

/**
 * 0034: o dono da plataforma chamando as RPCs de conexao Meta/Google com um
 * p_account_id INEXISTENTE e p_responsavel nulo recebe sem_permissao — nao a
 * FK crua 23503 de lead_sources. Antes da 0034 a guarda de papel deixava o
 * dono passar (papel_na_conta de conta inexistente e' null, sou_dono e' true)
 * e e_membro_da_conta(conta, null) e' true por definicao (0007).
 *
 * Segredo: o mesmo que supabase/seed.sql grava em ingestion_config.
 */
const SEGREDO = 'segredo-de-ingestao-local'
const CONTA_INEXISTENTE = '00000000-0000-4000-8000-00000000dead'

beforeEach(limparBanco)

async function erroDe(donoId: string, sql: string, params: unknown[]): Promise<string> {
  return comoUsuario(donoId, async (c) => {
    try {
      await c.query(sql, params)
    } catch (e) {
      return (e as Error).message
    }
    return 'nao lancou'
  })
}

describe('0034 — backstop de conta nas RPCs de conexao Meta/Google', () => {
  it('conectar_fonte_meta: dono + conta inexistente + responsavel nulo -> sem_permissao, nao 23503', async () => {
    const dono = await criarUsuario('dono1-0034@a.com')
    await tornarDono(dono)

    const msg = await erroDe(
      dono,
      'select public.conectar_fonte_meta($1, $2, $3, $4, $5, $6)',
      [SEGREDO, CONTA_INEXISTENTE, 'page-0034', 'Page', 'EAAG-token', null],
    )
    expect(msg).toBe('sem_permissao')
  })

  it('reivindicar_fonte_meta: idem', async () => {
    const dono = await criarUsuario('dono2-0034@a.com')
    await tornarDono(dono)

    const msg = await erroDe(
      dono,
      'select public.reivindicar_fonte_meta($1, $2, $3, $4, $5, $6)',
      [SEGREDO, CONTA_INEXISTENTE, 'page-0034', 'Page', 'EAAG-token', null],
    )
    expect(msg).toBe('sem_permissao')
  })

  it('conectar_fonte_google: idem', async () => {
    const dono = await criarUsuario('dono3-0034@a.com')
    await tornarDono(dono)

    const msg = await erroDe(
      dono,
      'select public.conectar_fonte_google($1, $2, $3, $4, $5)',
      [CONTA_INEXISTENTE, 'Google', 'url-token', 'google-key', null],
    )
    expect(msg).toBe('sem_permissao')
  })

  it('quem NAO e dono nem admin continua recebendo sem_permissao (guarda de papel intacta)', async () => {
    const qualquer = await criarUsuario('ninguem-0034@a.com')

    const msg = await erroDe(
      qualquer,
      'select public.conectar_fonte_meta($1, $2, $3, $4, $5, $6)',
      [SEGREDO, CONTA_INEXISTENTE, 'page-0034', 'Page', 'EAAG-token', null],
    )
    expect(msg).toBe('sem_permissao')
  })
})
