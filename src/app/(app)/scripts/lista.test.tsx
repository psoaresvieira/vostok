// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ListaDeScripts } from './lista'
import type { Script } from '@/lib/data/scripts'

// Mesmo motivo de tarefas/lista.test.tsx: o cleanup automatico do
// @testing-library/react so se registra com globals: true, e este
// vitest.config nao liga de proposito.
afterEach(cleanup)

function script(overrides: Partial<Script> = {}): Script {
  return {
    id: 'script-1',
    titulo: 'Abordagem inicial',
    conteudo: 'Olá {{primeiro_nome}}',
    stageId: 'etapa-1',
    tags: ['frio'],
    criadoEm: new Date('2026-01-01T00:00:00Z'),
    atualizadoEm: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

const NOMES = new Map([['etapa-1', 'Novo lead']])

describe('ListaDeScripts', () => {
  it('quem pode editar recebe o titulo linkado para a ficha', () => {
    render(
      <ListaDeScripts
        scripts={[script({ id: 'abc', titulo: 'Abordagem inicial' })]}
        nomeDaEtapa={NOMES}
        podeEditar={true}
      />,
    )

    const link = screen.getByRole('link', { name: 'Abordagem inicial' })
    expect(link.getAttribute('href')).toBe('/scripts/abc')
  })

  it('vendedor ve o titulo como texto, sem link — /scripts/[id] responde 404 para ele', () => {
    // O link existia para os tres papeis e /scripts/[id] responde notFound()
    // para vendedor: o titulo era um beco sem saida, um clique que so podia dar
    // 404. A biblioteca segue listavel e filtravel por ele; o que sai e a
    // promessa de navegacao que a rota nao cumpre. A guarda continua sendo o
    // notFound() da propria rota — isto aqui e nao oferecer o caminho.
    render(
      <ListaDeScripts
        scripts={[script({ id: 'abc', titulo: 'Abordagem inicial' })]}
        nomeDaEtapa={NOMES}
        podeEditar={false}
      />,
    )

    expect(screen.queryByRole('link', { name: 'Abordagem inicial' })).toBeNull()
    // Nao-vacuo: o titulo continua na tela, so nao e link. Sem esta linha o
    // teste passaria numa lista que simplesmente nao renderiza nada.
    expect(screen.getByText('Abordagem inicial')).toBeTruthy()
    // E nenhum <a> sobrou apontando para a ficha por outro caminho.
    expect(document.querySelector('a[href^="/scripts/"]')).toBeNull()
  })

  it('card mostra o nome da etapa, "Qualquer etapa" quando nula, e as tags — nos dois papeis', () => {
    for (const podeEditar of [true, false]) {
      render(
        <ListaDeScripts
          scripts={[
            script({ id: 'a', titulo: 'Com etapa', stageId: 'etapa-1', tags: ['frio', 'preço'] }),
            script({ id: 'b', titulo: 'Sem etapa', stageId: null, tags: [] }),
          ]}
          nomeDaEtapa={NOMES}
          podeEditar={podeEditar}
        />,
      )

      expect(screen.getByText('Novo lead')).toBeTruthy()
      expect(screen.getByText('Qualquer etapa')).toBeTruthy()
      expect(screen.getByText('frio')).toBeTruthy()
      expect(screen.getByText('preço')).toBeTruthy()
      cleanup()
    }
  })
})
