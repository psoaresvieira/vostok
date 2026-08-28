import { describe, expect, it } from 'vitest'
import { ok, falha } from '@/lib/domain/resultado'
import { envsObrigatorias, lerArgumentos } from './argumentos-operador'

const CONTA = '11111111-1111-4111-8111-111111111111'
const USER = '22222222-2222-4222-8222-222222222222'

describe('lerArgumentos', () => {
  it('le conta, page, env e defaults', () => {
    expect(lerArgumentos(['--conta', CONTA, '--page', '123', '--env', 'prod.env'])).toEqual(
      ok({ conta: CONTA, page: '123', responsavel: null, reivindicar: false, env: 'prod.env' }),
    )
  })
  it('aceita responsavel e reivindicar', () => {
    const r = lerArgumentos(['--conta', CONTA, '--page', '123', '--env', 'e', '--responsavel', USER, '--reivindicar'])
    expect(r).toEqual(ok({ conta: CONTA, page: '123', responsavel: USER, reivindicar: true, env: 'e' }))
  })
  it('recusa conta que nao e uuid, page vazia, responsavel invalido e env ausente', () => {
    expect(lerArgumentos(['--conta', 'abc', '--page', '123', '--env', 'e'])).toEqual(falha('conta_invalida'))
    expect(lerArgumentos(['--conta', CONTA, '--page', ' ', '--env', 'e'])).toEqual(falha('page_invalida'))
    expect(lerArgumentos(['--conta', CONTA, '--page', '1', '--env', 'e', '--responsavel', 'x'])).toEqual(falha('responsavel_invalido'))
    expect(lerArgumentos(['--page', '1', '--env', 'e'])).toEqual(falha('conta_invalida'))
    expect(lerArgumentos(['--conta', CONTA, '--page', '1'])).toEqual(falha('env_invalido'))
  })
  it('flag desconhecida ou argumento posicional: argumentos_invalidos, sem excecao', () => {
    expect(lerArgumentos(['--pagina', '1'])).toEqual(falha('argumentos_invalidos'))
    expect(lerArgumentos(['prod.env'])).toEqual(falha('argumentos_invalidos'))
  })
})

describe('envsObrigatorias', () => {
  const cheio = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
    INGESTAO_SEGREDO: 'seg',
    OPERADOR_EMAIL: 'dono@x',
    OPERADOR_SENHA: 's',
    META_TOKEN_SYSTEM_USER: 'tok',
  }
  it('devolve o conjunto quando tudo esta presente', () => {
    expect(envsObrigatorias(cheio as unknown as NodeJS.ProcessEnv)).toEqual(
      ok({ url: 'https://x.supabase.co', anonKey: 'anon', segredo: 'seg', email: 'dono@x', senha: 's', tokenMeta: 'tok' }),
    )
  })
  it('falha fechado nomeando a env vazia', () => {
    expect(envsObrigatorias({ ...cheio, INGESTAO_SEGREDO: '' } as unknown as NodeJS.ProcessEnv)).toEqual(
      falha('env_ausente:INGESTAO_SEGREDO'),
    )
    expect(envsObrigatorias({ ...cheio, META_TOKEN_SYSTEM_USER: undefined } as unknown as NodeJS.ProcessEnv)).toEqual(
      falha('env_ausente:META_TOKEN_SYSTEM_USER'),
    )
  })
})
