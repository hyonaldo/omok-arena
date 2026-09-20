import { useMemo, useState } from 'react'
import './App.css'
import { playSound } from './audio/sounds'
import { LocalRoom } from './core/local-room'
import { BOARD_SIZE, type Position, type Stone } from './core/types'
import { loadStats, recordResult } from './storage/stats'

const stoneName = (stone: Stone) => stone === 'black' ? '흑' : '백'
const pointKey = ({ row, col }: Position) => `${row}-${col}`

function BoardLines() {
  const lines = Array.from({ length: BOARD_SIZE }, (_, index) => index + 1)
  const stars = [[4, 4], [4, 12], [8, 8], [12, 4], [12, 12]]
  return (
    <svg className="board-lines" viewBox="0 0 16 16" aria-hidden="true">
      {lines.map((point) => <line key={`h${point}`} x1="1" y1={point} x2="15" y2={point} />)}
      {lines.map((point) => <line key={`v${point}`} x1={point} y1="1" x2={point} y2="15" />)}
      {stars.map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="0.13" />)}
    </svg>
  )
}

export default function App() {
  const room = useMemo(() => new LocalRoom(), [])
  const [game, setGame] = useState(room.state)
  const [stats, setStats] = useState(loadStats)
  const [cursor, setCursor] = useState<Position>({ row: 7, col: 7 })
  const winningPoints = new Set(game.winningLine.map(pointKey))
  const lastMove = game.moves.at(-1)

  const placeStone = (position: Position) => {
    const next = room.submitMove(position)
    if (next === game) return
    setGame(next)
    setCursor(position)
    playSound('stone')
    if (next.status === 'won' && next.winner) {
      setStats(recordResult(next.winner))
      playSound('victory')
    }
    if (next.status === 'draw') setStats(recordResult('draw'))
  }

  const newGame = () => {
    playSound('replay')
    setGame(room.reset())
    setCursor({ row: 7, col: 7 })
  }

  const moveCursor = (event: React.KeyboardEvent, position: Position) => {
    const delta: Record<string, Position> = {
      ArrowUp: { row: -1, col: 0 },
      ArrowDown: { row: 1, col: 0 },
      ArrowLeft: { row: 0, col: -1 },
      ArrowRight: { row: 0, col: 1 },
    }
    if (!delta[event.key]) return
    event.preventDefault()
    const next = {
      row: Math.max(0, Math.min(BOARD_SIZE - 1, position.row + delta[event.key].row)),
      col: Math.max(0, Math.min(BOARD_SIZE - 1, position.col + delta[event.key].col)),
    }
    setCursor(next)
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-point="${pointKey(next)}"]`)?.focus())
  }

  const resultTitle = game.status === 'draw' ? '무승부' : `${stoneName(game.winner!)} 승리`

  return (
    <main className="game-shell">
      <header className="topbar">
        <div className="brand" aria-label="하이옴즈 오목">
          <span className="brand-mark" aria-hidden="true"><i /><i /></span>
          <span>오목</span>
        </div>
        <div className="stats" aria-label="대국 기록">
          <span>{stats.totalGames}판</span>
          <span className="score"><i className="mini-stone black" />흑 {stats.blackWins}승</span>
          <span className="score"><i className="mini-stone white" />백 {stats.whiteWins}승</span>
        </div>
      </header>

      <section className="play-area" aria-label="로컬 2인 대국">
        <aside className={`turn-card ${game.turn}`} aria-live="polite">
          <span className={`turn-stone ${game.turn}`} aria-hidden="true" />
          <span>
            <small>{game.status === 'playing' ? '지금 둘 차례' : '대국 종료'}</small>
            <strong>{game.status === 'playing' ? `${stoneName(game.turn)} 차례` : resultTitle}</strong>
          </span>
        </aside>

        <div className="board-frame">
          <div className="board" role="grid" aria-label="오목판" aria-rowcount={BOARD_SIZE} aria-colcount={BOARD_SIZE}>
            <BoardLines />
            <div className="intersections">
              {game.board.map((row, rowIndex) => row.map((cell, colIndex) => {
                const position = { row: rowIndex, col: colIndex }
                const isLast = lastMove?.row === rowIndex && lastMove?.col === colIndex
                const isWinning = winningPoints.has(pointKey(position))
                const label = `${rowIndex + 1}행 ${colIndex + 1}열 ${cell ? `${stoneName(cell)}돌` : '빈자리'}`
                return (
                  <button
                    className={`point ${cell ? `occupied ${cell}` : ''} ${isWinning ? 'winning' : ''}`}
                    data-point={pointKey(position)}
                    key={pointKey(position)}
                    type="button"
                    role="gridcell"
                    aria-label={label}
                    aria-disabled={cell !== null || game.status !== 'playing'}
                    tabIndex={cursor.row === rowIndex && cursor.col === colIndex ? 0 : -1}
                    style={{ left: `${(colIndex / 14) * 100}%`, top: `${(rowIndex / 14) * 100}%` }}
                    onClick={() => placeStone(position)}
                    onKeyDown={(event) => moveCursor(event, position)}
                  >
                    {cell && <span className="stone" aria-hidden="true">{isLast && <i className="last-move" />}</span>}
                  </button>
                )
              }))}
            </div>

            {game.status !== 'playing' && (
              <div className="result-overlay" role="dialog" aria-modal="true" aria-labelledby="result-title">
                <div className={`result-stone ${game.winner ?? 'draw'}`} aria-hidden="true" />
                <p id="result-title">{resultTitle}</p>
                <button type="button" className="again-button" onClick={newGame}>한 판 더</button>
              </div>
            )}
          </div>
        </div>

        <p className="hint">빈 교차점을 누르면 바로 놓입니다</p>
      </section>
    </main>
  )
}
