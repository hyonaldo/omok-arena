import { describe, expect, it, vi } from 'vitest'
import {
  buildGroqRequest,
  parseGroqMove,
  RateLimitError,
  requestGroqMove,
  validateMoveRequest,
} from '../groq'
import type { Cell } from '../../core/types'

const emptyBoard = (): Cell[][] => Array.from({ length: 15 }, () => Array<Cell>(15).fill(null))

const groqResponse = (content: string) => ({
  choices: [{ message: { role: 'assistant', content } }],
})

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

  it('describes the position as compact coordinates instead of a text grid', () => {
    const board = emptyBoard()
    board[7][7] = 'black'
    board[8][8] = 'black'
    board[6][7] = 'white'
    const request = buildGroqRequest({ board, aiColor: 'white', moveNumber: 3, lastMove: { row: 8, col: 8 } }, 'openai/gpt-oss-120b')
    const userPrompt = request.messages.find((message) => message.role === 'user')!.content
    const systemPrompt = request.messages.find((message) => message.role === 'system')!.content
    expect(userPrompt).toContain('흑(상대): (7,7) (8,8)')
    expect(userPrompt).toContain('백(당신): (6,7)')
    expect(userPrompt).toContain('상대의 마지막 수: (8,8)')
    expect(userPrompt).not.toContain('...............')
    expect(systemPrompt).toContain('(행,열)')
    expect(systemPrompt).toContain('(0,0)')
  })

  it('builds a strict JSON-schema chat request without arbitrary user prompts', () => {
    const board = emptyBoard()
    board[7][7] = 'black'
    const request = buildGroqRequest({ board, aiColor: 'white', moveNumber: 1 }, 'openai/gpt-oss-20b')
    expect(request.model).toBe('openai/gpt-oss-20b')
    expect(request.reasoning_effort).toBe('low')
    expect(request.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: {
        strict: true,
        schema: {
          additionalProperties: false,
          required: ['row', 'col'],
          properties: {
            row: { minimum: 0, maximum: 14 },
            col: { minimum: 0, maximum: 14 },
          },
        },
      },
    })
    const userPrompt = request.messages.find((message) => message.role === 'user')!.content
    expect(userPrompt).toContain('(7,7)')
    expect(userPrompt).toContain('백(당신): 없음')
  })

  it('parses a legal move and repairs an occupied output to the nearest legal point', () => {
    const board = emptyBoard()
    board[7][7] = 'black'
    expect(parseGroqMove(groqResponse('{"row":7,"col":8}'), board)).toEqual({ row: 7, col: 8 })
    expect(parseGroqMove(groqResponse('{"row":7,"col":7}'), board)).toEqual({ row: 6, col: 7 })
    expect(() => parseGroqMove({ choices: [] }, board)).toThrow('응답')
  })

  it('sends the API key only as a bearer header and maps 429 to a quota message', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(groqResponse('{"row":6,"col":7}')), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const move = await requestGroqMove({
      apiKey: 'secret-test-key',
      model: 'openai/gpt-oss-20b',
      position: { board: emptyBoard(), aiColor: 'white', moveNumber: 0 },
      fetcher,
    })

    expect(move).toEqual({ row: 6, col: 7 })
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions')
    expect(url).not.toContain('secret-test-key')
    expect(init.headers.Authorization).toBe('Bearer secret-test-key')

    const limited = vi.fn().mockResolvedValue(new Response('{}', { status: 429, headers: { 'retry-after': '12' } }))
    const failure = await requestGroqMove({
      apiKey: 'k',
      model: 'openai/gpt-oss-20b',
      position: { board: emptyBoard(), aiColor: 'white', moveNumber: 0 },
      fetcher: limited,
    }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(RateLimitError)
    expect((failure as RateLimitError).retryAfterSeconds).toBe(12)
    expect((failure as Error).message).toContain('무료 사용량')
  })
})
