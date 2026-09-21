import type { Cell, Position, Stone } from '../core/types'

export type GeminiPosition = {
  board: Cell[][]
  aiColor: Stone
  moveNumber: number
}

type GeminiRequest = {
  contents: Array<{ role: 'user'; parts: Array<{ text: string }> }>
  generationConfig: {
    temperature: number
    maxOutputTokens: number
    responseMimeType: 'application/json'
    responseSchema: Record<string, unknown>
  }
}

const BOARD_SIZE = 15
const VALID_CELLS = new Set<Cell>([null, 'black', 'white'])

export class MoveRequestError extends Error {}

export function validateMoveRequest(value: unknown): GeminiPosition {
  if (!value || typeof value !== 'object') throw new MoveRequestError('대국 정보가 없습니다.')
  const input = value as Partial<GeminiPosition>
  if (!Array.isArray(input.board) || input.board.length !== BOARD_SIZE || input.board.some(
    (row) => !Array.isArray(row) || row.length !== BOARD_SIZE || row.some((cell) => !VALID_CELLS.has(cell)),
  )) throw new MoveRequestError('오목판은 유효한 15×15 배열이어야 합니다.')
  if (input.aiColor !== 'black' && input.aiColor !== 'white') throw new MoveRequestError('AI 색상이 올바르지 않습니다.')
  if (!Number.isInteger(input.moveNumber) || Number(input.moveNumber) < 0 || Number(input.moveNumber) > 224) {
    throw new MoveRequestError('착수 번호가 올바르지 않습니다.')
  }
  if (input.aiColor !== 'white') throw new MoveRequestError('공용 AI 대국에서는 Gemini가 백돌만 둡니다.')
  const cells = input.board.flat()
  const blackCount = cells.filter((cell) => cell === 'black').length
  const whiteCount = cells.filter((cell) => cell === 'white').length
  if (blackCount + whiteCount !== input.moveNumber) throw new MoveRequestError('착수 기록과 오목판이 일치하지 않습니다.')
  if (blackCount !== whiteCount + 1) throw new MoveRequestError('현재는 Gemini가 둘 차례가 아닙니다.')
  return input as GeminiPosition
}

function renderBoard(board: Cell[][]) {
  return board.map((row) => row.map((cell) => cell === 'black' ? 'B' : cell === 'white' ? 'W' : '.').join('')).join('\n')
}

export function buildGeminiRequest(position: GeminiPosition): GeminiRequest {
  const color = position.aiColor === 'black' ? '흑(B)' : '백(W)'
  const opponent = position.aiColor === 'black' ? '백(W)' : '흑(B)'
  const prompt = [
    '당신은 15×15 자유 오목의 강한 대국자입니다.',
    `당신은 ${color}, 상대는 ${opponent}입니다. B=흑, W=백, .=빈자리입니다.`,
    '가로·세로·대각선으로 5개 이상 연속이면 승리합니다. 장목은 허용됩니다.',
    '우선순위: 1) 즉시 승리 2) 상대의 즉시 승리 차단 3) 열린 4와 열린 3 형성·차단 4) 중앙 연결성.',
    '반드시 빈 교차점 하나만 선택하십시오. row와 col은 0부터 14까지입니다.',
    `현재 ${position.moveNumber}수째 이후의 보드:`,
    renderBoard(position.board),
  ].join('\n')

  return {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.25,
      maxOutputTokens: 64,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['row', 'col'],
        properties: {
          row: { type: 'integer', minimum: 0, maximum: 14 },
          col: { type: 'integer', minimum: 0, maximum: 14 },
        },
      },
    },
  }
}

export function parseGeminiMove(value: unknown, board: Cell[][]): Position {
  const response = value as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
  const text = response.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim()
  if (!text) throw new Error('Gemini 응답에 착수 정보가 없습니다.')

  let parsed: unknown
  try {
    parsed = JSON.parse(text.replace(/^```json\s*|\s*```$/g, ''))
  } catch {
    throw new Error('Gemini가 올바른 JSON을 반환하지 않았습니다.')
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('Gemini 착수 형식이 올바르지 않습니다.')
  const { row, col } = parsed as Partial<Position>
  if (!Number.isInteger(row) || !Number.isInteger(col) || row! < 0 || row! >= BOARD_SIZE || col! < 0 || col! >= BOARD_SIZE) {
    throw new Error('Gemini 착수 좌표가 범위를 벗어났습니다.')
  }
  if (board[row!][col!] !== null) throw new Error('Gemini가 이미 돌이 놓인 자리를 선택했습니다.')
  return { row: row!, col: col! }
}

export async function requestGeminiMove({
  apiKey,
  model,
  position,
  fetcher = fetch,
  signal,
}: {
  apiKey: string
  model: string
  position: GeminiPosition
  fetcher?: typeof fetch
  signal?: AbortSignal
}): Promise<Position> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
  const response = await fetcher(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(buildGeminiRequest(position)),
    signal,
  })
  if (!response.ok) {
    const retryAfter = response.headers.get('retry-after')
    if (response.status === 429) throw new Error(`Gemini 무료 사용량을 모두 사용했습니다.${retryAfter ? ` ${retryAfter}초 후 다시 시도하세요.` : ''}`)
    throw new Error(`Gemini 요청에 실패했습니다. (${response.status})`)
  }
  return parseGeminiMove(await response.json(), position.board)
}
