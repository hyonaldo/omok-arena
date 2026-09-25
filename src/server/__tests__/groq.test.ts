import { describe, expect, it, vi } from 'vitest'
import {
  buildGroqRequest,
  parseGroqChoice,
  RateLimitError,
  requestGroqMove,
  validateMoveRequest,
} from '../groq'
import { buildCandidates } from '../analysis'
import type { Cell } from '../../core/types'

const emptyBoard = (): Cell[][] => Array.from({ length: 15 }, () => Array<Cell>(15).fill(null))

const groqResponse = (content: string) => ({
  choices: [{ message: { role: 'assistant', content } }],
})

const quietBoard = () => {
  // 강제수가 없어 모델에게 넘어가는 전형적인 국면.
  const board = emptyBoard()
  board[7][7] = 'black'
  board[6][6] = 'white'
  board[9][3] = 'black'
  return board
}

describe('Groq move server adapter', () => {
  it('accepts only a valid 15 by 15 game position', () => {
    const board = emptyBoard()
    board[7][7] = 'black'
    expect(validateMoveRequest({ board, aiColor: 'white', moveNumber: 1 })).toEqual({
      board,
      aiColor: 'white',
      moveNumber: 1,
    })
    expect(() => validateMoveRequest({ board: [[null]], aiColor: 'white', moveNumber: 1 })).toThrow('15×15')
    expect(() => validateMoveRequest({ board, aiColor: 'green', moveNumber: 1 })).toThrow('색상')
  })

  it('accepts only a real white turn from the shared game endpoint', () => {
    const board = emptyBoard()
    expect(() => validateMoveRequest({ board, aiColor: 'white', moveNumber: 0 })).toThrow('차례')
    board[7][7] = 'black'
    expect(() => validateMoveRequest({ board, aiColor: 'black', moveNumber: 1 })).toThrow('백돌')
    expect(() => validateMoveRequest({ board, aiColor: 'white', moveNumber: 3 })).toThrow('착수 기록')
  })

  it('accepts an optional lastMove only when it points at a black stone', () => {
    const board = emptyBoard()
    board[7][7] = 'black'
    expect(validateMoveRequest({ board, aiColor: 'white', moveNumber: 1, lastMove: { row: 7, col: 7 } }).lastMove)
      .toEqual({ row: 7, col: 7 })
    expect(() => validateMoveRequest({ board, aiColor: 'white', moveNumber: 1, lastMove: { row: 0, col: 0 } })).toThrow('마지막 수')
    expect(() => validateMoveRequest({ board, aiColor: 'white', moveNumber: 1, lastMove: { row: 99, col: 0 } })).toThrow('마지막 수')
  })

  it('accepts a move history only when it matches the board', () => {
    const board = emptyBoard()
    board[7][7] = 'black'
    expect(validateMoveRequest({ board, aiColor: 'white', moveNumber: 1, moves: [{ row: 7, col: 7 }] }).moves)
      .toEqual([{ row: 7, col: 7 }])
    // 수순 길이가 착수 수와 다르거나 빈 자리를 가리키면 거절한다.
    expect(() => validateMoveRequest({ board, aiColor: 'white', moveNumber: 1, moves: [] })).toThrow('수순')
    expect(() => validateMoveRequest({ board, aiColor: 'white', moveNumber: 1, moves: [{ row: 0, col: 0 }] })).toThrow('수순')
  })

  it('shows the position as an ascii grid instead of a coordinate list', () => {
    const board = quietBoard()
    const candidates = buildCandidates(board, 'white')
    const request = buildGroqRequest(
      { board, aiColor: 'white', moveNumber: 3, lastMove: { row: 9, col: 3 } },
      'openai/gpt-oss-120b',
      candidates,
    )
    const userPrompt = request.messages.find((message) => message.role === 'user')!.content
    const systemPrompt = request.messages.find((message) => message.role === 'system')!.content

    // 격자에는 행 번호와 돌 기호가 함께 나타난다.
    expect(userPrompt).toMatch(/^ 7 .*X/m)
    expect(userPrompt).toMatch(/^ 6 .*O/m)
    expect(userPrompt).toContain('상대의 마지막 수: (9,3)')
    expect(userPrompt).not.toContain('흑(상대): (')
    expect(systemPrompt).toContain('X는 흑')
  })

  it('includes the recent move order when the client sends it', () => {
    const board = quietBoard()
    const request = buildGroqRequest(
      { board, aiColor: 'white', moveNumber: 3, moves: [{ row: 7, col: 7 }, { row: 6, col: 6 }, { row: 9, col: 3 }] },
      'openai/gpt-oss-120b',
      buildCandidates(board, 'white'),
    )
    const userPrompt = request.messages.find((message) => message.role === 'user')!.content
    expect(userPrompt).toContain('최근 수순: X(7,7) → O(6,6) → X(9,3)')
  })

  it('offers scored candidate ids and asks the model to reason before choosing', () => {
    const board = quietBoard()
    const candidates = buildCandidates(board, 'white')
    const request = buildGroqRequest({ board, aiColor: 'white', moveNumber: 3 }, 'openai/gpt-oss-20b', candidates)

    expect(request.model).toBe('openai/gpt-oss-20b')
    expect(request.reasoning_effort).toBe('medium')

    const schema = request.response_format.json_schema.schema as {
      required: string[]
      properties: { choice: { enum: string[] } }
    }
    // reasoning 이 choice 보다 먼저 와야 고르기 전에 생각할 공간이 생긴다.
    expect(schema.required).toEqual(['reasoning', 'choice'])
    expect(schema.properties.choice.enum).toEqual(candidates.map((candidate) => candidate.id))
    expect(request.response_format.json_schema.strict).toBe(true)

    const userPrompt = request.messages.find((message) => message.role === 'user')!.content
    expect(userPrompt).toContain(` ${candidates[0].id}: (${candidates[0].position.row},${candidates[0].position.col})`)
  })

  it('maps the chosen id back to its coordinate and rejects anything off the list', () => {
    const board = quietBoard()
    const candidates = buildCandidates(board, 'white')
    const target = candidates[1]

    expect(parseGroqChoice(groqResponse(`{"reasoning":"연결","choice":"${target.id}"}`), candidates))
      .toEqual(target.position)
    expect(() => parseGroqChoice(groqResponse('{"reasoning":"x","choice":"ZZ"}'), candidates)).toThrow('후보에 없는')
    expect(() => parseGroqChoice({ choices: [] }, candidates)).toThrow('응답')
  })

  it('never asks the model when the candidate list collapses to one point', async () => {
    // 한 자리만 비운 판: 물어볼 것이 없으므로 네트워크를 타지 않는다.
    const board: Cell[][] = Array.from({ length: 15 }, (_, row) =>
      Array.from({ length: 15 }, (_, col) => (row === 0 && col === 0 ? null : (row + col) % 2 ? 'black' : 'white')))
    const fetcher = vi.fn()

    const move = await requestGroqMove({
      apiKey: 'unused-key',
      model: 'openai/gpt-oss-120b',
      position: { board, aiColor: 'white', moveNumber: 224 },
      fetcher,
    })

    expect(move).toEqual({ row: 0, col: 0 })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('sends the API key only as a bearer header and maps 429 to a quota message', async () => {
    const board = quietBoard()
    const candidates = buildCandidates(board, 'white')
    const fetcher = vi.fn().mockResolvedValue(new Response(
      JSON.stringify(groqResponse(`{"reasoning":"중앙 연결","choice":"${candidates[0].id}"}`)),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))

    const move = await requestGroqMove({
      apiKey: 'secret-test-key',
      model: 'openai/gpt-oss-20b',
      position: { board, aiColor: 'white', moveNumber: 3 },
      fetcher,
    })

    expect(move).toEqual(candidates[0].position)
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions')
    expect(url).not.toContain('secret-test-key')
    expect(init.headers.Authorization).toBe('Bearer secret-test-key')

    const limited = vi.fn().mockResolvedValue(new Response('{}', { status: 429, headers: { 'retry-after': '12' } }))
    const failure = await requestGroqMove({
      apiKey: 'secret-test-key',
      model: 'openai/gpt-oss-20b',
      position: { board, aiColor: 'white', moveNumber: 3 },
      fetcher: limited,
    }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(RateLimitError)
    expect((failure as RateLimitError).retryAfterSeconds).toBe(12)
    expect((failure as Error).message).toContain('무료 사용량')
  })
})
