import { BOARD_SIZE, type Cell, type Position, type Stone } from '../core/types'
import {
  buildCandidates,
  type Candidate,
  otherStone,
  renderBoard,
  renderCandidates,
  renderRecentMoves,
} from './analysis'

export type MovePosition = {
  board: Cell[][]
  aiColor: Stone
  moveNumber: number
  lastMove?: Position
  /** 첫 수부터의 착수 순서. 있으면 상대 의도를 읽는 단서로 프롬프트에 넣는다. */
  moves?: Position[]
}

type ChatMessage = { role: 'system' | 'user'; content: string }

export type GroqRequest = {
  model: string
  reasoning_effort: 'medium'
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
  if (input.moves !== undefined) {
    if (!Array.isArray(input.moves) || input.moves.length !== input.moveNumber
      || input.moves.some((move) => !isPosition(move) || input.board![move.row][move.col] === null)) {
      throw new MoveRequestError('수순 정보가 오목판과 일치하지 않습니다.')
    }
  }
  return input as MovePosition
}

const SYSTEM_PROMPT = [
  '당신은 15×15 자유 오목의 강한 대국자입니다.',
  '',
  '판 읽는 법: 격자의 왼쪽 숫자가 행, 위쪽 숫자가 열입니다. X는 흑, O는 백, .은 빈 자리입니다.',
  '(0,0)은 왼쪽 위, (14,14)는 오른쪽 아래, (7,7)이 중앙입니다.',
  '가로·세로·대각선 어느 방향이든 같은 색 돌 5개 이상이 연속되면 승리합니다.',
  '',
  '위협 분석과 후보 목록은 코드가 정확히 계산한 사실이므로 그대로 신뢰하십시오.',
  '5목·열린4·양수걸침처럼 답이 정해진 국면은 이미 코드가 처리했습니다.',
  '당신이 받는 국면은 그런 강제수가 없는 상태이므로, 다음 기준으로 판단하십시오.',
  '1) 상대의 열린3을 방치하면 다음 수에 열린4가 되어 막을 수 없습니다. 우선 처리하십시오.',
  '2) 내 돌 두 개 이상과 연결되면서 두 방향으로 뻗을 수 있는 자리가 좋습니다.',
  '3) 같은 값이면 중앙과 상대 돌 근처가 유리합니다.',
  '',
  'reasoning에 한 문장으로 근거를 적고, choice에는 후보 ID 하나만 적으십시오.',
].join('\n')

export function buildGroqRequest(position: MovePosition, model: string, candidates: Candidate[]): GroqRequest {
  const me = position.aiColor
  const opponent = otherStone(me)
  const name = (stone: Stone) => stone === 'black' ? '흑(X)' : '백(O)'
  const history = renderRecentMoves(position.moves, position.board)

  const user = [
    `당신은 ${name(me)}, 상대는 ${name(opponent)}입니다. 현재 ${position.moveNumber}수가 놓였습니다.`,
    position.lastMove ? `상대의 마지막 수: (${position.lastMove.row},${position.lastMove.col})` : '',
    history ? `최근 수순: ${history}` : '',
    '',
    renderBoard(position.board),
    '',
    '후보 (코드가 계산한 위협. "내"는 당신이 그 자리에 뒀을 때, "상대"는 상대가 뒀을 때 생기는 모양):',
    renderCandidates(candidates),
    '',
    '후보 ID 하나를 고르십시오.',
  ].filter((line) => line !== '').join('\n')

  return {
    model,
    // gpt-oss는 추론 모델이라 low에서는 수읽기를 거의 하지 않는다. medium이 체감 기력 차이가 가장 크다.
    reasoning_effort: 'medium',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
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
          // reasoning이 choice보다 먼저 나와야 모델이 고르기 전에 생각할 공간이 생긴다.
          required: ['reasoning', 'choice'],
          properties: {
            reasoning: { type: 'string', description: '한 문장 근거' },
            choice: { type: 'string', enum: candidates.map((candidate) => candidate.id) },
          },
        },
      },
    },
  }
}

/** 모델이 고른 후보 ID를 좌표로 되돌린다. ID는 enum으로 강제되므로 빈 자리가 보장된다. */
export function parseGroqChoice(value: unknown, candidates: Candidate[]): Position {
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
  const { choice } = parsed as { choice?: unknown }
  const picked = candidates.find((candidate) => candidate.id === choice)
  if (!picked) throw new Error('AI가 후보에 없는 답을 반환했습니다.')
  return picked.position
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
  const candidates = buildCandidates(position.board, position.aiColor)
  if (!candidates.length) throw new Error('오목판에 둘 수 있는 자리가 없습니다.')
  // 후보가 하나뿐이면 물어볼 것이 없다.
  if (candidates.length === 1) return candidates[0].position

  const response = await fetcher(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(buildGroqRequest(position, model, candidates)),
    signal,
  })
  if (!response.ok) {
    if (response.status === 429) {
      const retryAfter = Number.parseFloat(response.headers.get('retry-after') ?? '')
      throw new RateLimitError(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : 15)
    }
    throw new Error(`AI 요청에 실패했습니다. (${response.status})`)
  }
  return parseGroqChoice(await response.json(), candidates)
}
