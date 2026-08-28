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

    // Cíclico: a sétima etapa (posicao 6) repete a cor da primeira (posicao 0).
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

  it('posicao negativa cicla corretamente', () => {
    const rosa = corDaEtapa(5, 'aberta')
    // posicao -1 deve ciclar para posicao 5 (pink)
    expect(corDaEtapa(-1, 'aberta')).toEqual(rosa)
  })

  it('posicao fracionaria e truncada', () => {
    const amarelo = corDaEtapa(1, 'aberta')
    // posicao 1.7 deve truncar para 1 (amber)
    expect(corDaEtapa(1.7, 'aberta')).toEqual(amarelo)
  })
})
