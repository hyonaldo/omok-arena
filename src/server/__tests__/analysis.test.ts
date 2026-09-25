import { describe, expect, it } from 'vitest'
import {
  buildCandidates,
  decideForcedMove,
  nearbyEmptyPoints,
  renderBoard,
  threatAt,
} from '../analysis'
import { BOARD_SIZE, type Cell, type Position, type Stone } from '../../core/types'

const emptyBoard = (): Cell[][] => Array.from({ length: BOARD_SIZE }, () => Array<Cell>(BOARD_SIZE).fill(null))

const withStones = (black: Position[], white: Position[] = []): Cell[][] => {
  const board = emptyBoard()
  black.forEach(({ row, col }) => { board[row][col] = 'black' })
  white.forEach(({ row, col }) => { board[row][col] = 'white' })
  return board
}

const row = (rendered: string, index: number) => rendered.split('\n')[index + 1]

describe('board rendering', () => {
  it('draws a grid whose row and column headers match the stone coordinates', () => {
    const board = withStones([{ row: 7, col: 7 }], [{ row: 8, col: 9 }])
    const rendered = renderBoard(board)

    // 헤더에 0..14 열 번호가 있고, 각 행은 자기 번호로 시작한다.
    expect(rendered.split('\n')[0]).toContain('14')
    expect(row(rendered, 7).startsWith(' 7')).toBe(true)
    // 흑은 X, 백은 O, 나머지는 점.
    expect(row(rendered, 7)).toContain('X')
    expect(row(rendered, 8)).toContain('O')
    expect(row(rendered, 0)).not.toContain('X')
    expect(rendered.split('\n')).toHaveLength(BOARD_SIZE + 1)
  })
})

describe('threat detection', () => {
  const tagAt = (board: Cell[][], position: Position, stone: Stone) => threatAt(board, position, stone)?.tag ?? null

  it('recognises a completed five', () => {
    const board = withStones([{ row: 7, col: 3 }, { row: 7, col: 4 }, { row: 7, col: 5 }, { row: 7, col: 6 }])
    expect(tagAt(board, { row: 7, col: 7 }, 'black')).toBe('five')
  })

  it('separates an open four from a four that is blocked on one side', () => {
    const open = withStones([{ row: 7, col: 5 }, { row: 7, col: 6 }, { row: 7, col: 7 }])
    expect(tagAt(open, { row: 7, col: 8 }, 'black')).toBe('openFour')

    const blocked = withStones(
      [{ row: 7, col: 5 }, { row: 7, col: 6 }, { row: 7, col: 7 }],
      [{ row: 7, col: 4 }],
    )
    expect(tagAt(blocked, { row: 7, col: 8 }, 'black')).toBe('four')
  })

  it('treats a three sealed on both sides as no threat at all', () => {
    const sealed = withStones(
      [{ row: 7, col: 6 }, { row: 7, col: 7 }],
      [{ row: 7, col: 4 }, { row: 7, col: 9 }],
    )
    // (7,5)..(7,8) 네 칸이 백돌 사이에 갇혀 5목을 만들 수 없다.
    expect(tagAt(sealed, { row: 7, col: 5 }, 'black')).toBe(null)
  })

  it('flags a point that opens two strong lines at once as a fork', () => {
    const board = withStones([
      { row: 5, col: 7 }, { row: 6, col: 7 },
      { row: 7, col: 5 }, { row: 7, col: 6 },
    ])
    const fork = threatAt(board, { row: 7, col: 7 }, 'black')
    expect(fork?.fork).toBe(true)

    const single = withStones([{ row: 7, col: 5 }, { row: 7, col: 6 }])
    expect(threatAt(single, { row: 7, col: 7 }, 'black')?.fork).toBe(false)
  })

  it('reports nothing for an occupied point', () => {
    const board = withStones([{ row: 7, col: 7 }])
    expect(threatAt(board, { row: 7, col: 7 }, 'black')).toBe(null)
  })
})

describe('candidate generation', () => {
  it('keeps only empty points near existing stones', () => {
    const board = withStones([{ row: 7, col: 7 }])
    const points = nearbyEmptyPoints(board)

    expect(points.every(({ row: r, col: c }) => Math.abs(r - 7) <= 2 && Math.abs(c - 7) <= 2)).toBe(true)
    expect(points.some(({ row: r, col: c }) => r === 7 && c === 7)).toBe(false)
    // 5x5 영역에서 돌이 놓인 한 칸을 뺀 값.
    expect(points).toHaveLength(24)
  })

  it('answers the centre on an empty board instead of every point', () => {
    expect(nearbyEmptyPoints(emptyBoard())).toEqual([{ row: 7, col: 7 }])
  })

  it('gives each candidate a distinct id and ranks urgent points first', () => {
    // 흑이 (7,4)(7,5)(7,6)으로 뻗어 있으므로 양 끝이 가장 급하다.
    const board = withStones(
      [{ row: 7, col: 4 }, { row: 7, col: 5 }, { row: 7, col: 6 }],
      [{ row: 0, col: 0 }, { row: 0, col: 1 }],
    )
    const candidates = buildCandidates(board, 'white')

    expect(new Set(candidates.map((candidate) => candidate.id)).size).toBe(candidates.length)
    expect(candidates[0].id).toBe('A')
    const urgent = candidates.slice(0, 2).map(({ position }) => `${position.row},${position.col}`)
    expect(urgent).toContain('7,3')
    expect(urgent).toContain('7,7')
    // enum 으로 넘기므로 후보 수는 제한된다.
    expect(candidates.length).toBeLessThanOrEqual(20)
  })
})

describe('forced move search', () => {
  it('answers the first black stone diagonally without asking the model', () => {
    const forced = decideForcedMove(withStones([{ row: 7, col: 7 }]), 'white')
    expect(forced).not.toBeNull()
    expect(Math.abs(forced!.position.row - 7)).toBe(1)
    expect(Math.abs(forced!.position.col - 7)).toBe(1)
  })

  it('completes its own five before blocking anything else', () => {
    const board = withStones(
      [{ row: 0, col: 0 }, { row: 1, col: 0 }, { row: 2, col: 0 }, { row: 3, col: 0 }, { row: 9, col: 9 }],
      [{ row: 7, col: 3 }, { row: 7, col: 4 }, { row: 7, col: 5 }, { row: 7, col: 6 }],
    )
    // 흑도 4목이지만 백이 먼저 두므로 자기 5목이 우선이다.
    const forced = decideForcedMove(board, 'white')
    expect(forced?.position).toEqual({ row: 7, col: 7 })
    expect(forced?.reason).toContain('5목')
  })

  it('blocks the opponent five when it cannot win this move', () => {
    const board = withStones(
      [{ row: 7, col: 3 }, { row: 7, col: 4 }, { row: 7, col: 5 }, { row: 7, col: 6 }],
      [{ row: 0, col: 0 }, { row: 5, col: 5 }, { row: 9, col: 9 }],
    )
    const forced = decideForcedMove(board, 'white')
    expect(forced?.position).toEqual({ row: 7, col: 7 })
    expect(forced?.reason).toContain('차단')
  })

  it('blocks an opponent open four rather than building its own plain three', () => {
    const board = withStones(
      [{ row: 7, col: 5 }, { row: 7, col: 6 }, { row: 7, col: 7 }, { row: 7, col: 8 }],
      [{ row: 2, col: 2 }, { row: 2, col: 3 }, { row: 11, col: 11 }, { row: 12, col: 12 }],
    )
    const forced = decideForcedMove(board, 'white')
    expect(forced).not.toBeNull()
    expect([`${forced!.position.row},${forced!.position.col}`]).toEqual(
      expect.arrayContaining([expect.stringMatching(/^7,(4|9)$/)]),
    )
  })

  it('hands quiet positions to the model instead of guessing', () => {
    const board = withStones(
      [{ row: 7, col: 7 }, { row: 9, col: 3 }],
      [{ row: 6, col: 6 }, { row: 2, col: 11 }],
    )
    expect(decideForcedMove(board, 'white')).toBeNull()
  })
})
