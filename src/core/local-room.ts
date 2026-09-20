import { applyMove, createGame } from './game'
import type { GameState, Position, Room } from './types'

export class LocalRoom implements Room {
  state: GameState = createGame()

  submitMove(position: Position) {
    this.state = applyMove(this.state, position)
    return this.state
  }

  reset() {
    this.state = createGame()
    return this.state
  }
}
