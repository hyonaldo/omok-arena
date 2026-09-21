import { describe, expect, it, vi } from 'vitest'
import { handleAiMove } from '../handler'
import type { Cell } from '../../core/types'

const board = (): Cell[][] => Array.from({ length: 15 }, () => Array<Cell>(15).fill(null))

describe('AI move API handler', () => {
  it('rejects unsupported methods and missing server credentials', async () => {
    const getResponse = await handleAiMove(new Request('https://example.test/api/ai-move'), {}, vi.fn())
    expect(getResponse.status).toBe(405)

    const postResponse = await handleAiMove(new Request('https://example.test/api/ai-move', {
      method: 'POST', body: JSON.stringify({ board: board(), aiColor: 'white', moveNumber: 0 }),
    }), {}, vi.fn())
    expect(postResponse.status).toBe(503)
  })

  it('returns one validated move and does not expose provider details', async () => {
    const position = board()
    position[7][7] = 'black'
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"row":7,"col":8}' }] } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const response = await handleAiMove(new Request('https://example.test/api/ai-move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board: position, aiColor: 'white', moveNumber: 1 }),
    }), { GEMINI_API_KEY: 'hidden-key', GEMINI_MODEL: 'gemini-test' }, fetcher)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ move: { row: 7, col: 8 } })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('returns a safe message for malformed game input', async () => {
    const response = await handleAiMove(new Request('https://example.test/api/ai-move', {
      method: 'POST', body: JSON.stringify({ board: [] }),
    }), { GEMINI_API_KEY: 'hidden-key' }, vi.fn())
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: '오목판은 유효한 15×15 배열이어야 합니다.' })

    const wrongTurn = await handleAiMove(new Request('https://example.test/api/ai-move', {
      method: 'POST', body: JSON.stringify({ board: board(), aiColor: 'white', moveNumber: 0 }),
    }), { GEMINI_API_KEY: 'hidden-key' }, vi.fn())
    expect(wrongTurn.status).toBe(400)
    expect(await wrongTurn.json()).toEqual({ error: '현재는 Gemini가 둘 차례가 아닙니다.' })
  })
})
