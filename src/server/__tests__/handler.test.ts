import { describe, expect, it, vi } from 'vitest'
import { handleAiMove } from '../handler'
import type { Cell } from '../../core/types'

const board = (): Cell[][] => Array.from({ length: 15 }, () => Array<Cell>(15).fill(null))
const groqResponse = (content: string) => JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] })

describe('AI move API handler', () => {
  it('rejects unsupported methods and missing server credentials', async () => {
    const getResponse = await handleAiMove(new Request('https://example.test/api/ai-move'), {}, vi.fn())
    expect(getResponse.status).toBe(405)

    const postResponse = await handleAiMove(new Request('https://example.test/api/ai-move', {
      method: 'POST', body: JSON.stringify({ board: board(), aiColor: 'white', moveNumber: 0 }),
    }), {}, vi.fn())
    expect(postResponse.status).toBe(503)
  })

  it('returns one validated move using the lightweight Groq model by default', async () => {
    const position = board()
    position[7][7] = 'black'
    const fetcher = vi.fn().mockResolvedValue(new Response(groqResponse('{"row":7,"col":8}'), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    const response = await handleAiMove(new Request('https://example.test/api/ai-move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board: position, aiColor: 'white', moveNumber: 1 }),
    }), { GROQ_API_KEY: 'hidden-key' }, fetcher)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ move: { row: 7, col: 8 } })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(fetcher).toHaveBeenCalledOnce()
    const sent = JSON.parse(fetcher.mock.calls[0][1].body)
    expect(sent.model).toBe('openai/gpt-oss-20b')
  })

  it('honours GROQ_MODEL when set and maps quota errors to 429', async () => {
    const position = board()
    position[7][7] = 'black'
    const fetcher = vi.fn().mockResolvedValue(new Response(groqResponse('{"row":7,"col":8}'), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    await handleAiMove(new Request('https://example.test/api/ai-move', {
      method: 'POST', body: JSON.stringify({ board: position, aiColor: 'white', moveNumber: 1 }),
    }), { GROQ_API_KEY: 'hidden-key', GROQ_MODEL: 'openai/gpt-oss-120b' }, fetcher)
    expect(JSON.parse(fetcher.mock.calls[0][1].body).model).toBe('openai/gpt-oss-120b')

    const limited = vi.fn().mockResolvedValue(new Response('{}', { status: 429 }))
    const response = await handleAiMove(new Request('https://example.test/api/ai-move', {
      method: 'POST', body: JSON.stringify({ board: position, aiColor: 'white', moveNumber: 1 }),
    }), { GROQ_API_KEY: 'hidden-key' }, limited)
    expect(response.status).toBe(429)
  })

  it('returns a safe message for malformed game input', async () => {
    const response = await handleAiMove(new Request('https://example.test/api/ai-move', {
      method: 'POST', body: JSON.stringify({ board: [] }),
    }), { GROQ_API_KEY: 'hidden-key' }, vi.fn())
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: '오목판은 유효한 15×15 배열이어야 합니다.' })

    const wrongTurn = await handleAiMove(new Request('https://example.test/api/ai-move', {
      method: 'POST', body: JSON.stringify({ board: board(), aiColor: 'white', moveNumber: 0 }),
    }), { GROQ_API_KEY: 'hidden-key' }, vi.fn())
    expect(wrongTurn.status).toBe(400)
    expect(await wrongTurn.json()).toEqual({ error: '현재는 AI가 둘 차례가 아닙니다.' })
  })
})
