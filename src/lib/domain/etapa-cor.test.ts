import { describe, expect, it } from 'vitest'
import { corDaEtapa } from './etapa-cor'

describe('corDaEtapa', () => {
  it('etapas abertas ciclam por seis familias de cor, na ordem', () => {
    const azul = corDaEtapa(0, 'aberta')
    const amarelo = corDaEtapa(1, 'aberta')
    const laranja = corDaEtapa(2, 'aberta')
    const verdeAgua = corDaEtapa(3, 'aberta')
    const roxo = corDaEtapa(4, 'aberta')
    const rosa = corDaEtapa(5, 'aberta')

    expect(azul.fundo).toContain('sky')
    expect(amarelo.fundo).toContain('amber')
    expect(laranja.fundo).toContain('orange')
    expect(verdeAgua.fundo).toContain('teal')
    expect(roxo.fundo).toContain('violet')
    expect(rosa.fundo).toContain('pink')

    // Cíclico: a sétima etapa (ordem 6) repete a cor da primeira (ordem 0).
    expect(corDaEtapa(6, 'aberta')).toEqual(azul)
  })

  it('etapa de ganho e sempre verde, independente da ordem', () => {
    expect(corDaEtapa(0, 'ganho').fundo).toContain('emerald')
    expect(corDaEtapa(3, 'ganho')).toEqual(corDaEtapa(0, 'ganho'))
  })

  it('etapa de perdido e sempre cinza, independente da ordem', () => {
    expect(corDaEtapa(0, 'perdido').fundo).toContain('zinc')
    expect(corDaEtapa(5, 'perdido')).toEqual(corDaEtapa(0, 'perdido'))
  })
})
