import { describe, expect, it, vi } from 'vitest'
import {
  buildGeminiRequest,
  parseGeminiMove,
  requestGeminiMove,
  validateMoveRequest,
} from '../gemini'
import type { Cell } from '../../core/types'

const emptyBoard = (): Cell[][] => Array.from({ length: 15 }, () => Array<Cell>(15).fill(null))

describe('Gemini move server adapter', () => {
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

  it('builds a constrained JSON-only request without arbitrary user prompts', () => {
    const board = emptyBoard()
    board[7][7] = 'black'
    const request = buildGeminiRequest({ board, aiColor: 'white', moveNumber: 1 })
    expect(request.generationConfig.responseMimeType).toBe('application/json')
    expect(request.generationConfig.responseSchema).toMatchObject({
      required: ['row', 'col'],
      properties: {
        row: { minimum: 0, maximum: 14 },
        col: { minimum: 0, maximum: 14 },
      },
    })
    expect(request.generationConfig.responseSchema).not.toHaveProperty('additionalProperties')
    expect(request.generationConfig).toMatchObject({ thinkingConfig: { thinkingLevel: 'minimal' } })
    expect(request.generationConfig).not.toHaveProperty('temperature')
    expect(request.generationConfig).not.toHaveProperty('maxOutputTokens')
    const prompt = request.contents[0].parts[0].text
    expect(prompt).toContain('.......B.......')
    expect(prompt).toContain('백(W)')
  })

  it('parses a legal move and repairs an occupied output to the nearest legal point', () => {
    const board = emptyBoard()
    board[7][7] = 'black'
    expect(parseGeminiMove({ candidates: [{ content: { parts: [{ text: '{"row":7,"col":8}' }] } }] }, board))
      .toEqual({ row: 7, col: 8 })
    expect(parseGeminiMove({ candidates: [{ content: { parts: [{ text: '{"row":7,"col":7}' }] } }] }, board))
      .toEqual({ row: 6, col: 7 })
    expect(() => parseGeminiMove({ candidates: [] }, board)).toThrow('응답')
  })

  it('keeps the API key out of the URL and sends it only as a header', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"row":6,"col":7}' }] } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const move = await requestGeminiMove({
      apiKey: 'secret-test-key',
      model: 'gemini-test',
      position: { board: emptyBoard(), aiColor: 'white', moveNumber: 0 },
      fetcher,
    })

    expect(move).toEqual({ row: 6, col: 7 })
    expect(fetcher).toHaveBeenCalledOnce()
    const [url, init] = fetcher.mock.calls[0]
    expect(url).not.toContain('secret-test-key')
    expect(init.headers['x-goog-api-key']).toBe('secret-test-key')
  })
})
