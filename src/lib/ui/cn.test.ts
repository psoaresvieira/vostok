import { describe, it, expect } from 'vitest'
import { cn } from './cn'

/**
 * Estes testes existem por causa de um bug real, e nao por completude: a
 * primeira versao do `cn` so' concatenava, e o `w-full` de BASE_CONTROLE
 * (campo.tsx) sobrevivia ao `w-auto`/`w-36` que os filtros do funil passavam
 * por cima. As duas classes iam para o atributo e a folha de estilo decidia —
 * os tres <select> viravam 100% de largura, empilhados um sobre o outro.
 *
 * O caso e' dificil de pegar em teste de componente: as classes ESTAO todas no
 * DOM, e o jsdom nao resolve cascata. Por isso a garantia mora aqui, na funcao.
 */
describe('cn', () => {
  it('a ultima classe do mesmo eixo vence', () => {
    expect(cn('w-full', 'w-36')).toBe('w-36')
    expect(cn('px-3', 'px-2.5')).toBe('px-2.5')
    expect(cn('text-sm', 'text-xs')).toBe('text-xs')
    expect(cn('h-10', 'h-8')).toBe('h-8')
  })

  it('o caso exato que quebrou a barra de filtros: campo largo virando select estreito', () => {
    const base = 'w-full rounded-xl border border-border bg-muted/60 px-3 text-sm'
    const r = cn(base, 'w-36 h-8 px-2.5 text-xs')
    expect(r).not.toContain('w-full')
    expect(r).toContain('w-36')
    // Classes de eixos diferentes seguem intactas — merge nao pode virar poda.
    expect(r).toContain('rounded-xl')
    expect(r).toContain('border-border')
    expect(r).toContain('bg-muted/60')
  })

  it('descarta condicionais falsas sem deixar espaco solto', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b')
    expect(cn()).toBe('')
  })

  it('nao mexe em classes que nao conflitam', () => {
    expect(cn('flex items-center', 'gap-2')).toBe('flex items-center gap-2')
  })
})
