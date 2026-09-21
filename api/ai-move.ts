import { handleAiMove } from '../src/server/handler'

export const config = { runtime: 'edge' }

export default function handler(request: Request) {
  return handleAiMove(request, {
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    GROQ_MODEL: process.env.GROQ_MODEL,
  })
}
