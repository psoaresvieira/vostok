// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { WhatsApp } from './whatsapp'
import { Integracoes } from './integracoes'
import { ok, falha } from '@/lib/domain/resultado'
import type { Resultado } from '@/lib/domain/resultado'
import type { ConexaoWhatsApp } from '@/lib/data/whatsapp'

// Mesmo motivo de etapas.test.tsx: o cleanup automatico do @testing-library/react
// so se registra com globals: true, e este vitest.config nao liga de proposito.
// Sem o registro manual, o document do jsdom persiste entre os it() deste
// arquivo e, do segundo render() em diante, as consultas acham no velho ou
// estouram "multiple elements found".
afterEach(cleanup)

// Integracoes chama useRouter() de 'next/navigation' no corpo do componente
// (router.replace/router.refresh mais abaixo, em caminhos que este arquivo nao
// exercita). Sem provider de App Router no jsdom puro, useRouter() de verdade
// lanca; o mock devolve so o que o componente chama.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }),
}))

/** Stub de acao que so registra as chamadas recebidas, sem tocar servidor
 * nenhum — o mesmo arranjo de etapas.test.tsx. */
function stubRegistrando<A extends unknown[], T>(
  resultado: Resultado<T>,
): { fn: (...args: A) => Promise<Resultado<T>>; chamadas: A[] } {
  const chamadas: A[] = []
  const fn = async (...args: A): Promise<Resultado<T>> => {
    chamadas.push(args)
    return resultado
  }
  return { fn, chamadas }
}

function conexao(overrides: Partial<ConexaoWhatsApp> = {}): ConexaoWhatsApp {
  return {
    id: 'conn-1',
    phoneNumberId: '1234567890',
    wabaId: 'waba-xyz',
    numeroExibicao: '+55 11 99999-9999',
    nomeVerificado: 'Empresa Exemplo',
    criadoEm: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

describe('WhatsApp', () => {
  it('desconectado renderiza os tres campos e envia o que foi digitado', async () => {
    const { fn: conectar, chamadas } = stubRegistrando<
      [{ token: string; phoneNumberId: string; wabaId: string }],
      void
    >(ok(undefined))

    render(<WhatsApp conexao={null} conectar={conectar} />)

    fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'token-abc' } })
    fireEvent.change(screen.getByLabelText('ID do número'), {
      target: { value: '1234567890' },
    })
    fireEvent.change(screen.getByLabelText('ID da WABA'), { target: { value: 'waba-novo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Conectar' }))

    await waitFor(() => expect(chamadas).toHaveLength(1))
    expect(chamadas).toEqual([
      [{ token: 'token-abc', phoneNumberId: '1234567890', wabaId: 'waba-novo' }],
    ])
  })

  it('conectado mostra numero, nome verificado e waba — e nao existe nenhum input', () => {
    render(
      <WhatsApp
        conexao={conexao({
          numeroExibicao: '+55 11 98888-7777',
          nomeVerificado: 'Loja da Esquina',
          wabaId: 'waba-conectada',
        })}
      />,
    )

    expect(screen.getByText('+55 11 98888-7777')).toBeTruthy()
    expect(screen.getByText('Loja da Esquina')).toBeTruthy()
    expect(screen.getByText('waba-conectada')).toBeTruthy()
    // O token nunca volta do servidor (ConexaoWhatsApp nao tem esse campo) —
    // esta asercao trava que a tela tambem nao inventa um campo pra ele, nem
    // deixa nenhum outro input a mostra no estado conectado.
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
  })

  it('desconectar pede confirmacao: cancelar nao chama, confirmar chama com o id certo', () => {
    const c = conexao({ id: 'conn-9' })

    // Confirma.
    const confirmando = stubRegistrando<[string], void>(ok(undefined))
    render(<WhatsApp conexao={c} desconectar={confirmando.fn} />)
    fireEvent.click(screen.getByRole('button', { name: /desconectar/i }))
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }))
    expect(confirmando.chamadas).toEqual([['conn-9']])
    cleanup()

    // Cancela.
    const cancelando = stubRegistrando<[string], void>(ok(undefined))
    render(<WhatsApp conexao={c} desconectar={cancelando.fn} />)
    fireEvent.click(screen.getByRole('button', { name: /desconectar/i }))
    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }))
    expect(cancelando.chamadas).toHaveLength(0)
  })

  it('recusa traduzida: o texto exibido e a mensagem do mapa, nao o codigo', async () => {
    const { fn: conectar } = stubRegistrando<
      [{ token: string; phoneNumberId: string; wabaId: string }],
      void
    >(falha('token_whatsapp_invalido'))

    render(<WhatsApp conexao={null} conectar={conectar} />)

    fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'token-errado' } })
    fireEvent.change(screen.getByLabelText('ID do número'), { target: { value: '111' } })
    fireEvent.change(screen.getByLabelText('ID da WABA'), { target: { value: 'waba' } })
    fireEvent.click(screen.getByRole('button', { name: 'Conectar' }))

    expect(
      await screen.findByText(
        'O Meta recusou esse token para esse número. Confira os dois no painel.',
      ),
    ).toBeTruthy()
    expect(screen.queryByText('token_whatsapp_invalido')).toBeNull()
  })
})

describe('Integracoes — nota beta do Meta', () => {
  const TEXTO_NOTA =
    'Durante o beta, a conexão com o Facebook é liberada por convite — fale com a gente para habilitar sua conta.'

  it('aparece so quando modoBeta e true; false nao muda o DOM', () => {
    render(
      <Integracoes
        fontes={[]}
        membros={[]}
        origem="http://localhost:3000"
        etapa={null}
        entregas={[]}
        modoBeta={true}
      />,
    )
    expect(screen.getByText(TEXTO_NOTA)).toBeTruthy()
    cleanup()

    render(
      <Integracoes
        fontes={[]}
        membros={[]}
        origem="http://localhost:3000"
        etapa={null}
        entregas={[]}
        modoBeta={false}
      />,
    )
    expect(screen.queryByText(TEXTO_NOTA)).toBeNull()
  })
})
