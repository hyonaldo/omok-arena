import { MoveRequestError, RateLimitError, requestGroqMove, validateMoveRequest } from './groq'

type GroqEnvironment = {
  GROQ_API_KEY?: string
  GROQ_MODEL?: string
}

// 무료 티어에서 strict JSON 출력을 지원하는 Groq 모델 중 오목 판단력이 더 좋은 쪽.
export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b'
// Groq이 요구하는 대기가 이 시간 이하면 함수 안에서 기다렸다가 한 번 더 시도한다.
// 그보다 길면 Edge 함수 실행 시간을 낭비하지 않고 클라이언트가 카운트다운 후 재요청하게 한다.
const MAX_INLINE_WAIT_SECONDS = 8

const json = (body: unknown, status: number, extraHeaders: Record<string, string> = {}) => Response.json(body, {
  status,
  headers: {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders,
  },
})

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function handleAiMove(
  request: Request,
  environment: GroqEnvironment,
  fetcher: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'POST 요청만 지원합니다.' }, 405)
  const apiKey = environment.GROQ_API_KEY
  if (!apiKey) return json({ error: 'AI 대국이 아직 준비되지 않았습니다.' }, 503)

  let input: unknown
  try {
    input = await request.json()
  } catch {
    return json({ error: '요청 본문이 올바른 JSON이 아닙니다.' }, 400)
  }

  try {
    const position = validateMoveRequest(input)
    const attempt = () => requestGroqMove({
      apiKey,
      model: environment.GROQ_MODEL || DEFAULT_GROQ_MODEL,
      position,
      fetcher,
      signal: AbortSignal.timeout(20_000),
    })
    try {
      return json({ move: await attempt() }, 200)
    } catch (error) {
      if (!(error instanceof RateLimitError) || error.retryAfterSeconds > MAX_INLINE_WAIT_SECONDS) throw error
      await sleep(error.retryAfterSeconds * 1000)
      return json({ move: await attempt() }, 200)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI 착수에 실패했습니다.'
    if (error instanceof MoveRequestError) return json({ error: message }, 400)
    if (error instanceof RateLimitError) {
      return json({ error: message, retryAfter: error.retryAfterSeconds }, 429, { 'Retry-After': String(error.retryAfterSeconds) })
    }
    return json({ error: message }, 502)
  }
}
