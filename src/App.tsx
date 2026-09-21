import { useMemo, useRef, useState } from 'react'
import './App.css'
import { RequestPacer } from './agent/pacer'
import { playSound } from './audio/sounds'
import { LocalRoom } from './core/local-room'
import { BOARD_SIZE, type GameState, type Position, type Stone } from './core/types'
import { loadStats, recordResult } from './storage/stats'

const stoneName = (stone: Stone) => stone === 'black' ? '흑' : '백'
const pointKey = ({ row, col }: Position) => `${row}-${col}`
type GameMode = 'local' | 'ai'
// 이 시간 이하의 Retry-After는 사용자에게 카운트다운을 보여주며 자동 재시도한다.
// 그보다 길면 사용자가 직접 재요청하거나 대신 두도록 선택지를 준다.
const MAX_AUTO_WAIT_SECONDS = 45
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
// 렌더 밖(이벤트 핸들러)에서만 호출되는 시계. 컴포넌트 본문에서 Date.now를 직접 부르지 않기 위해 분리.
const clockNow = () => Date.now()

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
  const [mode, setMode] = useState<GameMode>('local')
  const [isAiThinking, setIsAiThinking] = useState(false)
  const [aiWaitSeconds, setAiWaitSeconds] = useState<number | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [manualAiTurn, setManualAiTurn] = useState(false)
  const requestId = useRef(0)
  const pacer = useMemo(() => new RequestPacer(), [])
  const winningPoints = new Set(game.winningLine.map(pointKey))
  const lastMove = game.moves.at(-1)

  const commitGame = (next: GameState) => {
    setGame(next)
    if (next.status === 'won' && next.winner) {
      setStats(recordResult(next.winner))
      playSound('victory')
    }
    if (next.status === 'draw') setStats(recordResult('draw'))
  }

  const sleepWithCountdown = async (ms: number, currentRequest: number) => {
    const deadline = clockNow() + ms
    while (true) {
      const remaining = deadline - clockNow()
      if (remaining <= 0 || currentRequest !== requestId.current) break
      setAiWaitSeconds(Math.ceil(remaining / 1000))
      await wait(Math.min(remaining, 500))
    }
    setAiWaitSeconds(null)
  }

  const requestAiMove = async (position: GameState) => {
    const currentRequest = ++requestId.current
    setIsAiThinking(true)
    setAiError(null)
    setManualAiTurn(false)

    try {
      const last = position.moves.at(-1)
      const body = JSON.stringify({
        board: position.board,
        aiColor: 'white',
        moveNumber: position.moves.length,
        lastMove: last ? { row: last.row, col: last.col } : undefined,
      })

      let data: { move?: Position; error?: string; retryAfter?: number } = {}
      let response: Response
      // 최대 2회 시도: 첫 요청 + (짧은 Retry-After면) 자동 재시도 1회.
      for (let attempt = 0; ; attempt += 1) {
        const delay = pacer.delayBeforeNext()
        if (delay > 0) await sleepWithCountdown(delay, currentRequest)
        if (currentRequest !== requestId.current) return

        pacer.markSent()
        response = await fetch('/api/ai-move', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        })
        const responseText = await response.text()
        data = {}
        try {
          data = JSON.parse(responseText) as typeof data
        } catch {
          if (response.ok) throw new Error('Groq 응답을 읽을 수 없습니다.')
        }

        if (response.status === 429 && attempt === 0) {
          const retryAfter = data.retryAfter ?? Number.parseInt(response.headers.get('Retry-After') ?? '', 10)
          if (Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= MAX_AUTO_WAIT_SECONDS) {
            pacer.backOff(retryAfter)
            continue
          }
        }
        break
      }
      if (!response.ok) throw new Error(data.error || 'Groq이 응답하지 않았습니다.')
      const move = data.move
      if (!move || !Number.isInteger(move.row) || !Number.isInteger(move.col)
        || move.row < 0 || move.row >= BOARD_SIZE || move.col < 0 || move.col >= BOARD_SIZE
        || position.board[move.row][move.col] !== null) {
        throw new Error('Groq이 둘 수 없는 자리를 선택했습니다.')
      }
      if (currentRequest !== requestId.current || room.state !== position || room.state.turn !== 'white') return
      const next = room.submitMove(move)
      setCursor(move)
      playSound('stone')
      commitGame(next)
    } catch (error) {
      if (currentRequest !== requestId.current) return
      setAiError(error instanceof Error ? error.message : 'Groq이 응답하지 않았습니다.')
    } finally {
      if (currentRequest === requestId.current) {
        setIsAiThinking(false)
        setAiWaitSeconds(null)
      }
    }
  }

  const placeStone = (position: Position) => {
    if (game.status !== 'playing' || isAiThinking) return
    if (mode === 'ai' && game.turn === 'white' && !manualAiTurn) return
    const wasManualAiTurn = mode === 'ai' && game.turn === 'white'
    const next = room.submitMove(position)
    if (next === game) return
    setCursor(position)
    playSound('stone')
    commitGame(next)
    if (wasManualAiTurn) {
      setManualAiTurn(false)
      setAiError(null)
    }
    if (mode === 'ai' && next.status === 'playing' && next.turn === 'white') void requestAiMove(next)
  }

  const resetGame = () => {
    requestId.current += 1
    setIsAiThinking(false)
    setAiWaitSeconds(null)
    setAiError(null)
    setManualAiTurn(false)
    setGame(room.reset())
    setCursor({ row: 7, col: 7 })
  }

  const newGame = () => {
    playSound('replay')
    resetGame()
  }

  const changeMode = (nextMode: GameMode) => {
    if (nextMode === mode) return
    setMode(nextMode)
    resetGame()
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
  const turnTitle = mode === 'ai'
    ? isAiThinking
      ? aiWaitSeconds !== null ? `Groq 대기 중… ${aiWaitSeconds}초` : 'Groq 생각 중…'
      : game.turn === 'black' ? '내 차례' : manualAiTurn ? '백돌을 놓아주세요' : 'Groq 차례'
    : `${stoneName(game.turn)} 차례`
  const boardLocked = game.status !== 'playing' || isAiThinking || (mode === 'ai' && game.turn === 'white' && !manualAiTurn)

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

      <section className="play-area" aria-label={mode === 'ai' ? 'Groq 대국' : '로컬 2인 대국'}>
        <div className="mode-switch" role="group" aria-label="대국 방식">
          <button type="button" aria-pressed={mode === 'local'} onClick={() => changeMode('local')}>둘이 두기</button>
          <button type="button" aria-pressed={mode === 'ai'} onClick={() => changeMode('ai')}>Groq과 대국</button>
        </div>

        <aside className={`turn-card ${game.turn} ${isAiThinking ? 'thinking' : ''}`} aria-live="polite">
          <span className={`turn-stone ${game.turn}`} aria-hidden="true" />
          <span>
            <small>{game.status === 'playing' ? (mode === 'ai' ? '나: 흑 · AI: 백' : '지금 둘 차례') : '대국 종료'}</small>
            <strong>{game.status === 'playing' ? turnTitle : resultTitle}</strong>
          </span>
        </aside>

        <div className="board-frame">
          <div className="board" role="grid" aria-label="오목판" aria-rowcount={BOARD_SIZE} aria-colcount={BOARD_SIZE} aria-busy={isAiThinking}>
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
                    aria-disabled={cell !== null || boardLocked}
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

        <div className="game-footer">
          {aiError && (
            <div className="ai-error" role="status">
              <span>{aiError}</span>
              <div>
                <button type="button" onClick={() => void requestAiMove(game)}>다시 요청</button>
                <button type="button" onClick={() => { setManualAiTurn(true); setAiError(null) }}>이번 수는 사람이 두기</button>
              </div>
            </div>
          )}
          <p className="hint">{mode === 'ai' ? '당신은 흑돌입니다 · 빈 교차점을 눌러 두세요' : '빈 교차점을 누르면 바로 놓입니다'}</p>
        </div>
      </section>
    </main>
  )
}