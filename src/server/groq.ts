import type { Cell, Position, Stone } from '../core/types'

export type MovePosition = {
  board: Cell[][]
  aiColor: Stone
  moveNumber: number
  lastMove?: Position
}

type ChatMessage = { role: 'system' | 'user'; content: string }

export type GroqRequest = {
  model: string
  reasoning_effort: 'low'
  messages: ChatMessage[]
  response_format: {
    type: 'json_schema'
    json_schema: {
      name: string
      strict: true
      schema: Record<string, unknown>
    }
  }
}

const BOARD_SIZE = 15
const VALID_CELLS = new Set<Cell>([null, 'black', 'white'])
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

export class MoveRequestError extends Error {}

export class RateLimitError extends Error {
  readonly retryAfterSeconds: number
  constructor(retryAfterSeconds: number) {
    super(`AI 무료 사용량을 모두 사용했습니다. ${retryAfterSeconds}초 후 다시 시도하세요.`)
    this.retryAfterSeconds = retryAfterSeconds
  }
}

const isPosition = (value: unknown): value is Position => {
  if (!value || typeof value !== 'object') return false
  const { row, col } = value as Partial<Position>
  return Number.isInteger(row) && Number.isInteger(col)
    && row! >= 0 && row! < BOARD_SIZE && col! >= 0 && col! < BOARD_SIZE
}

export function validateMoveRequest(value: unknown): MovePosition {
  if (!value || typeof value !== 'object') throw new MoveRequestError('대국 정보가 없습니다.')
  const input = value as Partial<MovePosition>
  if (!Array.isArray(input.board) || input.board.length !== BOARD_SIZE || input.board.some(
    (row) => !Array.isArray(row) || row.length !== BOARD_SIZE || row.some((cell) => !VALID_CELLS.has(cell)),
  )) throw new MoveRequestError('오목판은 유효한 15×15 배열이어야 합니다.')
  if (input.aiColor !== 'black' && input.aiColor !== 'white') throw new MoveRequestError('AI 색상이 올바르지 않습니다.')
  if (!Number.isInteger(input.moveNumber) || Number(input.moveNumber) < 0 || Number(input.moveNumber) > 224) {
    throw new MoveRequestError('착수 번호가 올바르지 않습니다.')
  }
  if (input.aiColor !== 'white') throw new MoveRequestError('공용 AI 대국에서는 AI가 백돌만 둡니다.')
  const cells = input.board.flat()
  const blackCount = cells.filter((cell) => cell === 'black').length
  const whiteCount = cells.filter((cell) => cell === 'white').length
  if (blackCount + whiteCount !== input.moveNumber) throw new MoveRequestError('착수 기록과 오목판이 일치하지 않습니다.')
  if (blackCount !== whiteCount + 1) throw new MoveRequestError('현재는 AI가 둘 차례가 아닙니다.')
  if (input.lastMove !== undefined) {
    if (!isPosition(input.lastMove) || input.board[input.lastMove.row][input.lastMove.col] !== 'black') {
      throw new MoveRequestError('마지막 수 정보가 오목판과 일치하지 않습니다.')
    }
  }
  return input as MovePosition
}

const coordinate = ({ row, col }: Position) => `(${row},${col})`

function listStones(board: Cell[][], stone: Stone) {
  const points: string[] = []
  board.forEach((row, rowIndex) => row.forEach((cell, colIndex) => {
    if (cell === stone) points.push(coordinate({ row: rowIndex, col: colIndex }))
  }))
  return points.length ? points.join(' ') : '없음'
}

export function buildGroqRequest(position: MovePosition, model: string): GroqRequest {
  const me: Stone = position.aiColor
  const opponent: Stone = me === 'black' ? 'white' : 'black'
  const name = (stone: Stone) => stone === 'black' ? '흑' : '백'
  const system = [
    '당신은 15×15 자유 오목의 강한 대국자입니다.',
    '좌표 표기: 모든 점은 (행,열)이며 0부터 14까지의 정수입니다. (0,0)은 왼쪽 위, (14,14)는 오른쪽 아래, (7,7)은 중앙입니다.',
    '이웃 관계: 같은 행에서 열이 1씩 차이나면 가로로 인접, 같은 열에서 행이 1씩 차이나면 세로로 인접, 행과 열이 함께 1씩 변하면 대각선으로 인접합니다.',
    '규칙: 가로·세로·대각선으로 같은 색 돌 5개 이상이 연속되면 승리합니다. 장목도 승리입니다.',
    '우선순위: 1) 내가 즉시 5를 만들 수 있으면 그 점 2) 상대가 다음 수에 5를 만들 수 있으면 그 점을 차단 3) 상대의 열린 4·열린 3을 막고 내 열린 4·열린 3을 만들기 4) 기존 돌과 연결되는 중앙 쪽 점.',
    '목록에 없는 점만 비어 있습니다. 반드시 비어 있는 점 하나를 선택하고, 요청된 JSON만 반환하십시오.',
  ].join('\n')
  const user = [
    `당신은 ${name(me)}, 상대는 ${name(opponent)}입니다. 현재 ${position.moveNumber}수가 놓였습니다.`,
    `${name(opponent)}(상대): ${listStones(position.board, opponent)}`,
    `${name(me)}(당신): ${listStones(position.board, me)}`,
    position.lastMove ? `상대의 마지막 수: ${coordinate(position.lastMove)}` : '',
    '당신의 다음 한 수를 선택하세요.',
  ].join('\n')

  return {
    model,
    reasoning_effort: 'low',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'gomoku_move',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['row', 'col'],
          properties: {
            row: { type: 'integer', minimum: 0, maximum: 14 },
            col: { type: 'integer', minimum: 0, maximum: 14 },
          },
        },
      },
    },
  }
}

export function parseGroqMove(value: unknown, board: Cell[][]): Position {
  const response = value as { choices?: Array<{ message?: { content?: string | null } }> }
  const text = response.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error('AI 응답에 착수 정보가 없습니다.')

  let parsed: unknown
  try {
    parsed = JSON.parse(text.replace(/^```json\s*|\s*```$/g, ''))
  } catch {
    throw new Error('AI가 올바른 JSON을 반환하지 않았습니다.')
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('AI 착수 형식이 올바르지 않습니다.')
  const { row, col } = parsed as Partial<Position>
  if (!Number.isInteger(row) || !Number.isInteger(col) || row! < 0 || row! >= BOARD_SIZE || col! < 0 || col! >= BOARD_SIZE) {
    throw new Error('AI 착수 좌표가 범위를 벗어났습니다.')
  }
  if (board[row!][col!] === null) return { row: row!, col: col! }
  for (let distance = 1; distance < BOARD_SIZE * 2; distance += 1) {
    for (let candidateRow = 0; candidateRow < BOARD_SIZE; candidateRow += 1) {
      for (let candidateCol = 0; candidateCol < BOARD_SIZE; candidateCol += 1) {
        if (Math.abs(candidateRow - row!) + Math.abs(candidateCol - col!) === distance
          && board[candidateRow][candidateCol] === null) {
          return { row: candidateRow, col: candidateCol }
        }
      }
    }
  }
  throw new Error('오목판에 둘 수 있는 자리가 없습니다.')
}

export async function requestGroqMove({
  apiKey,
  model,
  position,
  fetcher = fetch,
  signal,
}: {
  apiKey: string
  model: string
  position: MovePosition
  fetcher?: typeof fetch
  signal?: AbortSignal
}): Promise<Position> {
  const response = await fetcher(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(buildGroqRequest(position, model)),
    signal,
  })
  if (!response.ok) {
    if (response.status === 429) {
      const retryAfter = Number.parseFloat(response.headers.get('retry-after') ?? '')
      throw new RateLimitError(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : 15)
    }
    throw new Error(`AI 요청에 실패했습니다. (${response.status})`)
  }
  return parseGroqMove(await response.json(), position.board)
}
