import { describe, expect, it, vi } from 'vitest'
import {
  buildGroqRequest,
  parseGroqMove,
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
    expect(userPrompt).toContain('.......B.......')
    expect(userPrompt).toContain('백(W)')
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
    await expect(requestGroqMove({
      apiKey: 'k',
      model: 'openai/gpt-oss-20b',
      position: { board: emptyBoard(), aiColor: 'white', moveNumber: 0 },
      fetcher: limited,
    })).rejects.toThrow('무료 사용량')
  })
})
