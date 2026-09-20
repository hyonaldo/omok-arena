import { BOARD_SIZE, type Cell, type GameState, type Position, type Stone } from './types'

const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
] as const

const otherStone = (stone: Stone): Stone => stone === 'black' ? 'white' : 'black'
const inBounds = ({ row, col }: Position) => row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE

function emptyBoard(): Cell[][] {
  return Array.from({ length: BOARD_SIZE }, () => Array<Cell>(BOARD_SIZE).fill(null))
}

export function createGame(): GameState {
  return {
    board: emptyBoard(),
    turn: 'black',
    moves: [],
    status: 'playing',
    winner: null,
    winningLine: [],
  }
}

function findWinningLine(board: Cell[][], position: Position, stone: Stone): Position[] {
  for (const [rowDelta, colDelta] of DIRECTIONS) {
    const line: Position[] = [position]

    for (const direction of [-1, 1]) {
      let row = position.row + rowDelta * direction
      let col = position.col + colDelta * direction
      while (inBounds({ row, col }) && board[row][col] === stone) {
        line.push({ row, col })
        row += rowDelta * direction
        col += colDelta * direction
      }
    }

    if (line.length >= 5) {
      return line.sort((a, b) => a.row - b.row || a.col - b.col)
    }
  }
  return []
}

export function applyMove(state: GameState, position: Position): GameState {
  if (state.status !== 'playing' || !inBounds(position) || state.board[position.row][position.col] !== null) return state

  const board = state.board.map((row) => [...row])
  board[position.row][position.col] = state.turn
  const moves = [...state.moves, { ...position, stone: state.turn, moveNumber: state.moves.length + 1 }]
  const winningLine = findWinningLine(board, position, state.turn)

  if (winningLine.length >= 5) {
    return { ...state, board, moves, status: 'won', winner: state.turn, winningLine }
  }
  if (moves.length === BOARD_SIZE * BOARD_SIZE) {
    return { ...state, board, moves, status: 'draw', winningLine: [] }
  }

  return { ...state, board, moves, turn: otherStone(state.turn) }
}
