import type { Cell, Position, Stone } from '../core/types'

export type MovePosition = {
  board: Cell[][]
  aiColor: Stone
  moveNumber: number
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
  return input as MovePosition
}

function renderBoard(board: Cell[][]) {
  return board.map((row) => row.map((cell) => cell === 'black' ? 'B' : cell === 'white' ? 'W' : '.').join('')).join('\n')
}

export function buildGroqRequest(position: MovePosition, model: string): GroqRequest {
  const color = position.aiColor === 'black' ? '흑(B)' : '백(W)'
  const opponent = position.aiColor === 'black' ? '백(W)' : '흑(B)'
  const system = [
    '당신은 15×15 자유 오목의 강한 대국자입니다.',
    '가로·세로·대각선으로 5개 이상 연속이면 승리합니다. 장목은 허용됩니다.',
    '우선순위: 1) 즉시 승리 2) 상대의 즉시 승리 차단 3) 열린 4와 열린 3 형성·차단 4) 중앙 연결성.',
    '반드시 빈 교차점(.) 하나만 선택하고, 요청된 JSON만 반환하십시오. row와 col은 0부터 14까지입니다.',
  ].join('\n')
  const user = [
    `당신은 ${color}, 상대는 ${opponent}입니다. B=흑, W=백, .=빈자리입니다.`,
    `현재 ${position.moveNumber}수째 이후의 보드:`,
    renderBoard(position.board),
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
    const retryAfter = response.headers.get('retry-after')
    if (response.status === 429) throw new Error(`AI 무료 사용량을 모두 사용했습니다.${retryAfter ? ` ${retryAfter}초 후 다시 시도하세요.` : ''}`)
    throw new Error(`AI 요청에 실패했습니다. (${response.status})`)
  }
  return parseGroqMove(await response.json(), position.board)
}
