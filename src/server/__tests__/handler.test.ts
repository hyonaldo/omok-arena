import { describe, expect, it, vi } from 'vitest'
import { handleAiMove } from '../handler'
import { buildCandidates } from '../analysis'
import type { Cell } from '../../core/types'

const board = (): Cell[][] => Array.from({ length: 15 }, () => Array<Cell>(15).fill(null))

/** 강제수가 없어 모델 호출까지 가는 국면. 흑 2 · 백 1 이라 백 차례다. */
const quietBoard = () => {
  const position = board()
  position[7][7] = 'black'
  position[6][6] = 'white'
  position[9][3] = 'black'
  return position
}

const quietRequest = () => ({ board: quietBoard(), aiColor: 'white', moveNumber: 3 })

const choiceResponse = (id: string) =>
  JSON.stringify({ choices: [{ message: { role: 'assistant', content: `{"reasoning":"테스트","choice":"${id}"}` } }] })

const okResponse = (id: string) => new Response(choiceResponse(id), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
})

const post = (body: unknown) => new Request('https://example.test/api/ai-move', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

describe('AI move API handler', () => {
  it('rejects unsupported methods and missing server credentials', async () => {
    const getResponse = await handleAiMove(new Request('https://example.test/api/ai-move'), {}, vi.fn())
    expect(getResponse.status).toBe(405)

    const postResponse = await handleAiMove(post({ board: board(), aiColor: 'white', moveNumber: 0 }), {}, vi.fn())
    expect(postResponse.status).toBe(503)
  })

  it('returns one validated move using the 120B Groq model by default', async () => {
    const position = quietBoard()
    const firstId = buildCandidates(position, 'white')[0].id
    const fetcher = vi.fn().mockResolvedValue(okResponse(firstId))

    const response = await handleAiMove(
      post({ board: position, aiColor: 'white', moveNumber: 3 }),
      { GROQ_API_KEY: 'hidden-key' },
      fetcher,
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      move: buildCandidates(position, 'white')[0].position,
      source: 'model',
    })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(fetcher).toHaveBeenCalledOnce()
    expect(JSON.parse(fetcher.mock.calls[0][1].body).model).toBe('openai/gpt-oss-120b')
  })

  it('honours GROQ_MODEL when set', async () => {
    const position = quietBoard()
    const firstId = buildCandidates(position, 'white')[0].id
    const fetcher = vi.fn().mockResolvedValue(okResponse(firstId))

    await handleAiMove(
      post({ board: position, aiColor: 'white', moveNumber: 3 }),
      { GROQ_API_KEY: 'hidden-key', GROQ_MODEL: 'openai/gpt-oss-20b' },
      fetcher,
    )
    expect(JSON.parse(fetcher.mock.calls[0][1].body).model).toBe('openai/gpt-oss-20b')
  })

  it('answers a forced position from search without spending a model request', async () => {
    // 흑이 4목을 만들었으므로 막을 자리가 하나뿐이다. 모델을 부를 이유가 없다.
    const position = board()
    for (const col of [3, 4, 5, 6]) position[7][col] = 'black'
    position[13][13] = 'black'
    for (const [row, col] of [[0, 0], [0, 2], [2, 0], [12, 0]]) position[row][col] = 'white'
    const fetcher = vi.fn()

    const response = await handleAiMove(
      post({ board: position, aiColor: 'white', moveNumber: 9 }),
      { GROQ_API_KEY: 'hidden-key' },
      fetcher,
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ move: { row: 7, col: 7 }, source: 'search' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('waits and retries once inside the function when Groq asks for a short pause', async () => {
    const position = quietBoard()
    const firstId = buildCandidates(position, 'white')[0].id
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'retry-after': '3' } }))
      .mockResolvedValueOnce(okResponse(firstId))
    const sleep = vi.fn().mockResolvedValue(undefined)

    const response = await handleAiMove(
      post(quietRequest()),
      { GROQ_API_KEY: 'hidden-key' },
      fetcher,
      sleep,
    )

    expect(response.status).toBe(200)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(3000)
  })

  it('returns 429 with Retry-After when the pause is too long to absorb', async () => {
    const limited = vi.fn().mockResolvedValue(new Response('{}', { status: 429, headers: { 'retry-after': '45' } }))
    const sleep = vi.fn()

    const response = await handleAiMove(
      post(quietRequest()),
      { GROQ_API_KEY: 'hidden-key' },
      limited,
      sleep,
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('45')
    expect(await response.json()).toMatchObject({ retryAfter: 45 })
    expect(sleep).not.toHaveBeenCalled()
    expect(limited).toHaveBeenCalledOnce()
  })

  it('returns a safe message for malformed game input', async () => {
    const response = await handleAiMove(post({ board: [] }), { GROQ_API_KEY: 'hidden-key' }, vi.fn())
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: '오목판은 유효한 15×15 배열이어야 합니다.' })

    const wrongTurn = await handleAiMove(
      post({ board: board(), aiColor: 'white', moveNumber: 0 }),
      { GROQ_API_KEY: 'hidden-key' },
      vi.fn(),
    )
    expect(wrongTurn.status).toBe(400)
    expect(await wrongTurn.json()).toEqual({ error: '현재는 AI가 둘 차례가 아닙니다.' })
  })
})
