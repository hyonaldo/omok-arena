import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App'
import { playSound } from './audio/sounds'

vi.mock('./audio/sounds', () => ({ playSound: vi.fn() }))

describe('local two-player game', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    cleanup()
  })

  it('opens directly on a playable board with quiet match stats', () => {
    render(<App />)
    expect(screen.getByRole('grid', { name: '오목판' })).toBeInTheDocument()
    expect(screen.getByText('흑 차례')).toBeInTheDocument()
    expect(screen.getByText('0판')).toBeInTheDocument()
    expect(screen.getByText('흑 0승')).toBeInTheDocument()
    expect(screen.getByText('백 0승')).toBeInTheDocument()
  })

  it('shows the winner and starts another game with one button', () => {
    render(<App />)
    const move = (row: number, col: number) => fireEvent.click(screen.getByRole('gridcell', { name: `${row + 1}행 ${col + 1}열 빈자리` }))
    move(7, 2); move(8, 2)
    move(7, 3); move(8, 3)
    move(7, 4); move(8, 4)
    move(7, 5); move(8, 5)
    move(7, 6)

    expect(screen.getByRole('dialog')).toHaveTextContent('흑 승리')
    expect(screen.getByText('1판')).toBeInTheDocument()
    expect(playSound).toHaveBeenCalledWith('stone')
    expect(playSound).toHaveBeenCalledWith('victory')
    fireEvent.click(screen.getByRole('button', { name: '한 판 더' }))
    expect(playSound).toHaveBeenCalledWith('replay')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('흑 차례')).toBeInTheDocument()
  })

  it('lets the player switch to Groq and receives a validated white move', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ move: { row: 6, col: 7 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Groq과 대국' }))
    fireEvent.click(screen.getByRole('gridcell', { name: '8행 8열 빈자리' }))
    expect(screen.getByText('Groq 생각 중…')).toBeInTheDocument()

    await waitFor(() => expect(screen.getByRole('gridcell', { name: '7행 8열 백돌' })).toBeInTheDocument())
    expect(screen.getByText('내 차례')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledOnce()
    const [, request] = fetchMock.mock.calls[0]
    expect(JSON.parse(request.body)).toMatchObject({ aiColor: 'white', moveNumber: 1 })
    vi.unstubAllGlobals()
  })

  it('keeps the game playable when Groq is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: '무료 사용량을 모두 사용했습니다.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    })))
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Groq과 대국' }))
    fireEvent.click(screen.getByRole('gridcell', { name: '8행 8열 빈자리' }))
    await screen.findByText('무료 사용량을 모두 사용했습니다.')
    fireEvent.click(screen.getByRole('button', { name: '이번 수는 사람이 두기' }))
    fireEvent.click(screen.getByRole('gridcell', { name: '7행 8열 빈자리' }))
    expect(screen.getByRole('gridcell', { name: '7행 8열 백돌' })).toBeInTheDocument()
    expect(screen.getByText('내 차례')).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('shows a friendly recovery message for a non-JSON server failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('An error occurred', { status: 500 })))
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Groq과 대국' }))
    fireEvent.click(screen.getByRole('gridcell', { name: '8행 8열 빈자리' }))

    await screen.findByText('Groq이 응답하지 않았습니다.')
    expect(screen.getByRole('button', { name: '이번 수는 사람이 두기' })).toBeInTheDocument()
  })
})
