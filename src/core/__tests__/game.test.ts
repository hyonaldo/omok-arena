import { describe, expect, it } from 'vitest'
import { applyMove, createGame } from '../game'
import type { Position } from '../types'

function play(moves: Position[]) {
  return moves.reduce((state, position) => applyMove(state, position), createGame())
}

describe('omok game engine', () => {
  it('starts with an empty 15 by 15 board and black to move', () => {
    const game = createGame()
    expect(game.board).toHaveLength(15)
    expect(game.board.flat().every((cell) => cell === null)).toBe(true)
    expect(game.turn).toBe('black')
    expect(game.status).toBe('playing')
  })

  it('alternates turns and rejects occupied intersections', () => {
    const afterBlack = applyMove(createGame(), { row: 7, col: 7 })
    expect(afterBlack.board[7][7]).toBe('black')
    expect(afterBlack.turn).toBe('white')

    const rejected = applyMove(afterBlack, { row: 7, col: 7 })
    expect(rejected).toBe(afterBlack)
  })

  it.each([
    ['horizontal', [{ row: 3, col: 1 }, { row: 3, col: 2 }, { row: 3, col: 3 }, { row: 3, col: 4 }, { row: 3, col: 5 }]],
    ['vertical', [{ row: 1, col: 3 }, { row: 2, col: 3 }, { row: 3, col: 3 }, { row: 4, col: 3 }, { row: 5, col: 3 }]],
    ['descending diagonal', [{ row: 1, col: 1 }, { row: 2, col: 2 }, { row: 3, col: 3 }, { row: 4, col: 4 }, { row: 5, col: 5 }]],
    ['ascending diagonal', [{ row: 5, col: 1 }, { row: 4, col: 2 }, { row: 3, col: 3 }, { row: 2, col: 4 }, { row: 1, col: 5 }]],
  ] as const)('detects a black %s five-in-a-row', (_name, blackMoves) => {
    const moves: Position[] = []
    blackMoves.forEach((move, index) => {
      moves.push(move)
      if (index < 4) moves.push({ row: 14, col: index })
    })

    const game = play(moves)
    expect(game.status).toBe('won')
    expect(game.winner).toBe('black')
    expect(game.winningLine).toHaveLength(5)
  })

  it('allows overlines and blocks moves after the game ends', () => {
    let game = createGame()
    const setup: Array<[Position, 'black' | 'white']> = [
      [{ row: 7, col: 0 }, 'black'], [{ row: 14, col: 0 }, 'white'],
      [{ row: 7, col: 1 }, 'black'], [{ row: 14, col: 1 }, 'white'],
      [{ row: 7, col: 2 }, 'black'], [{ row: 14, col: 2 }, 'white'],
      [{ row: 7, col: 4 }, 'black'], [{ row: 14, col: 3 }, 'white'],
      [{ row: 7, col: 5 }, 'black'], [{ row: 13, col: 0 }, 'white'],
    ]
    for (const [position] of setup) game = applyMove(game, position)
    game = applyMove(game, { row: 7, col: 3 })
    expect(game.status).toBe('won')
    expect(game.winningLine).toHaveLength(6)
    expect(applyMove(game, { row: 0, col: 0 })).toBe(game)
  })
})
