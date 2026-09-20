import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import App from './App'

describe('local two-player game', () => {
  beforeEach(() => localStorage.clear())
  afterEach(cleanup)

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
    fireEvent.click(screen.getByRole('button', { name: '한 판 더' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('흑 차례')).toBeInTheDocument()
  })
})
