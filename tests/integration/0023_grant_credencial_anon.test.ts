import { describe, it, expect } from 'vitest'
import { comoServico } from './helpers/db'

/**
 * As duas RPCs do disparo sao chamadas pelo MESMO cliente anonimo + segredo
 * (criarDisparoServico, lib/data/templates.ts), e ate a 0023 so uma delas tinha
 * o grant explicito para `anon`: `atualizar_status_template` (0022) tinha,
 * `credencial_whatsapp` (0019) nao.
 *
 * O caso NAO nasce vermelho, e e' por isso que ele existe: hoje a chamada
 * anonima passa pelo EXECUTE que o default ACL desta imagem do Postgres deixa
 * para PUBLIC. O que este teste tranca e' o futuro — um `revoke execute ...
 * from public` de endurecimento (a 0021 ja fez essa classe de mudanca em
 * tabelas) derrubaria o disparo inteiro, e o sintoma na tela seria "conecte um
 * numero de WhatsApp", apontando para o lugar errado. Com o grant explicito da
 * 0023, esse revoke nao alcanca o caminho de producao.
 */
describe('0023 — grant de credencial_whatsapp para anon', () => {
  it('anon tem execute nas DUAS RPCs do disparo, e nao so na de status', async () => {
    const linha = await comoServico(async (cli) => {
      const r = await cli.query<{ credencial: boolean; status: boolean }>(
        `select
           has_function_privilege('anon', 'public.credencial_whatsapp(text, uuid)', 'execute')
             as credencial,
           has_function_privilege(
             'anon', 'public.atualizar_status_template(text, uuid, text, text)', 'execute'
           ) as status`,
      )
      return r.rows[0]
    })

    expect(linha.credencial).toBe(true)
    // Regressao da 0022, no mesmo assert: as duas andam juntas ou o disparo
    // funciona pela metade.
    expect(linha.status).toBe(true)
  })
})
