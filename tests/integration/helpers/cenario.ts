import { comoServico, comoUsuario, criarUsuario } from './db'

export type Cenario = {
  accountId: string
  pipelineId: string
  etapas: { id: string; nome: string; ordem: number; tipo: string }[]
  motivoId: string
  adminId: string
  gestorId: string
  vendedorAId: string
  vendedorBId: string
}

/** Uma conta com admin, gestor e dois vendedores, pipeline padrao ja semeado. */
export async function montarCenario(): Promise<Cenario> {
  const adminId = await criarUsuario('admin@a.com')
  const gestorId = await criarUsuario('gestor@a.com')
  const vendedorAId = await criarUsuario('va@a.com')
  const vendedorBId = await criarUsuario('vb@a.com')

  const accountId = await comoUsuario(adminId, async (c) =>
    (await c.query<{ id: string }>('select public.criar_conta($1) as id', ['SE7E'])).rows[0].id,
  )

  await comoServico((c) =>
    c.query(
      `insert into public.memberships (account_id, user_id, papel) values
        ($1, $2, 'gestor'), ($1, $3, 'vendedor'), ($1, $4, 'vendedor')`,
      [accountId, gestorId, vendedorAId, vendedorBId],
    ),
  )

  const { pipelineId, etapas, motivoId } = await comoServico(async (c) => {
    const p = await c.query<{ id: string }>(
      'select id from public.pipelines where account_id = $1',
      [accountId],
    )
    const s = await c.query(
      'select id, nome, ordem, tipo from public.stages where pipeline_id = $1 order by ordem',
      [p.rows[0].id],
    )
    const m = await c.query<{ id: string }>(
      `select id from public.loss_reasons where account_id = $1 and nome = 'Preço'`,
      [accountId],
    )
    return { pipelineId: p.rows[0].id, etapas: s.rows, motivoId: m.rows[0].id }
  })

  return { accountId, pipelineId, etapas, motivoId, adminId, gestorId, vendedorAId, vendedorBId }
}

export function etapa(c: Cenario, nome: string): string {
  const e = c.etapas.find((x) => x.nome === nome)
  if (!e) throw new Error(`etapa nao encontrada: ${nome}`)
  return e.id
}

export async function criarLead(
  c: Cenario,
  nome: string,
  responsavelId: string | null,
  etapaId: string,
): Promise<string> {
  return comoServico(async (cli) => {
    const r = await cli.query<{ id: string }>(
      `insert into public.leads (account_id, nome, pipeline_id, stage_id, responsavel_id)
       values ($1, $2, $3, $4, $5) returning id`,
      [c.accountId, nome, c.pipelineId, etapaId, responsavelId],
    )
    return r.rows[0].id
  })
}
