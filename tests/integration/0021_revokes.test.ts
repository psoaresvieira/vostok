import { describe, it, expect, beforeEach } from 'vitest'
import { comoUsuario, limparBanco } from './helpers/db'
import { montarCenario, type Cenario } from './helpers/cenario'

/**
 * Guarda silenciosa no 6 (item 3 da secao 0 do progresso.md): o default ACL
 * desta imagem concede TRUNCATE/REFERENCES/TRIGGER/MAINTAIN (Dxtm) a
 * anon/authenticated em toda tabela nova, e TRUNCATE nao passa pela RLS.
 * source_credentials e ingestion_config nunca tiveram revoke nenhum (0008);
 * whatsapp_connections so teve TRUNCATE revogado na 0019, deixando
 * references/trigger/maintain como residuo. Migration 0021 fecha os dois.
 *
 * Casos 1 e 2 sao o RED: passam hoje (o revoke ainda nao existe).
 */
describe('0021 — revokes da guarda silenciosa no 6', () => {
  let c: Cenario
  beforeEach(async () => {
    await limparBanco()
    c = await montarCenario()
  })

  it('Caso 1: truncate em source_credentials e negado', async () => {
    await expect(
      comoUsuario(c.adminId, (cli) => cli.query('truncate public.source_credentials')),
    ).rejects.toThrow(/permission denied/i)
  })

  it('Caso 2: truncate em ingestion_config e negado', async () => {
    await expect(
      comoUsuario(c.adminId, (cli) => cli.query('truncate public.ingestion_config')),
    ).rejects.toThrow(/permission denied/i)
  })

  it('Caso 3: select em source_credentials e negado por privilegio, nao por RLS (zero linhas)', async () => {
    await expect(
      comoUsuario(c.adminId, (cli) => cli.query('select * from public.source_credentials')),
    ).rejects.toThrow(/permission denied/i)
  })

  it('Caso 4: truncate em whatsapp_connections continua negado (regressao da 0019)', async () => {
    await expect(
      comoUsuario(c.adminId, (cli) => cli.query('truncate public.whatsapp_connections')),
    ).rejects.toThrow(/permission denied/i)
  })
})
