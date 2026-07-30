import { describe, it, expect, afterEach, vi } from 'vitest'
import { usarFalso, metaGraph, metaFalso } from './fabrica'
import { MetaGraphReal } from './meta-real'

/**
 * usarFalso() e o unico predicado de "estamos em teste", e a fabrica de
 * qual MetaGraph a rota de OAuth usa depende dele. A falsa aceita qualquer
 * credencial em silencio — se ela subisse em producao por variavel mal
 * configurada, o CRM passaria a confiar em token que o Meta nunca validou,
 * sem erro nenhum. E por isso que o predicado nao pode ser so "META_FAKE=1":
 * production tem que vencer, sempre.
 *
 * `vi.stubEnv`/`vi.unstubAllEnvs`, e nao atribuicao direta a process.env: o
 * plugin de tipos do Next declara `NODE_ENV` como `readonly`, entao
 * `process.env.NODE_ENV = ...` nem compila. stubEnv restaura o valor original
 * sozinho, o que evita vazar estado de um teste para o outro.
 */
describe('usarFalso', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('liga a falsa quando META_FAKE=1 e NODE_ENV nao e production', () => {
    vi.stubEnv('META_FAKE', '1')
    vi.stubEnv('NODE_ENV', 'test')
    expect(usarFalso()).toBe(true)
  })

  it('recusa a falsa quando META_FAKE=1 mas NODE_ENV=production', () => {
    vi.stubEnv('META_FAKE', '1')
    vi.stubEnv('NODE_ENV', 'production')
    expect(usarFalso()).toBe(false)
  })

  it('desliga a falsa quando META_FAKE nao esta definida', () => {
    vi.stubEnv('META_FAKE', undefined)
    vi.stubEnv('NODE_ENV', 'test')
    expect(usarFalso()).toBe(false)
  })
})

/**
 * `fabrica.test.ts` so afirmava sobre `usarFalso()`, nunca sobre `metaGraph()`
 * em si — que e a invariante que de fato importa (a rota de OAuth so chama
 * `metaGraph()`, nunca `usarFalso()` diretamente). `fabrica.ts:33` podia ser
 * editado para quebrar a escolha (ex.: sempre devolver o falso, ou nunca)
 * com os tres testes de usarFalso() acima continuando verdes, porque nenhum
 * deles olha o que `metaGraph()` devolve.
 */
describe('metaGraph', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('devolve a instancia compartilhada do falso quando usarFalso() e true', () => {
    vi.stubEnv('META_FAKE', '1')
    vi.stubEnv('NODE_ENV', 'test')
    expect(metaGraph()).toBe(metaFalso())
  })

  it('devolve MetaGraphReal em producao, mesmo com META_FAKE=1', () => {
    vi.stubEnv('META_FAKE', '1')
    vi.stubEnv('NODE_ENV', 'production')
    expect(metaGraph()).toBeInstanceOf(MetaGraphReal)
  })
})

describe('metaFalso', () => {
  it('e singleton no processo — o E2E depende disso para a Page assinada num request continuar assinada no seguinte', () => {
    expect(metaFalso()).toBe(metaFalso())
  })
})
