export const BOARD_SIZE = 15

export type Stone = 'black' | 'white'
export type Cell = Stone | null
export type Position = { row: number; col: number }
export type Move = Position & { stone: Stone; moveNumber: number }
export type GameStatus = 'playing' | 'won' | 'draw'

export type GameState = {
  board: Cell[][]
  turn: Stone
  moves: Move[]
  status: GameStatus
  winner: Stone | null
  winningLine: Position[]
}

export interface Room {
  readonly state: GameState
  submitMove(position: Position): GameState
  reset(): GameState
}
