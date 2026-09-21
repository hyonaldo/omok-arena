import { handleAiMove } from '../src/server/handler'

export const config = { runtime: 'edge' }

export default function handler(request: Request) {
  return handleAiMove(request, {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
  })
}
