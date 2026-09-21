import { MoveRequestError, requestGeminiMove, validateMoveRequest } from './gemini'

type GeminiEnvironment = {
  GEMINI_API_KEY?: string
  GEMINI_MODEL?: string
}

const json = (body: unknown, status: number) => Response.json(body, {
  status,
  headers: {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  },
})

export async function handleAiMove(
  request: Request,
  environment: GeminiEnvironment,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'POST 요청만 지원합니다.' }, 405)
  if (!environment.GEMINI_API_KEY) return json({ error: 'AI 대국이 아직 준비되지 않았습니다.' }, 503)

  let input: unknown
  try {
    input = await request.json()
  } catch {
    return json({ error: '요청 본문이 올바른 JSON이 아닙니다.' }, 400)
  }

  try {
    const position = validateMoveRequest(input)
    const move = await requestGeminiMove({
      apiKey: environment.GEMINI_API_KEY,
      model: environment.GEMINI_MODEL || 'gemini-2.5-flash',
      position,
      fetcher,
      signal: AbortSignal.timeout(20_000),
    })
    return json({ move }, 200)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI 착수에 실패했습니다.'
    if (error instanceof MoveRequestError) return json({ error: message }, 400)
    if (message.includes('무료 사용량')) return json({ error: message }, 429)
    return json({ error: message }, 502)
  }
}
