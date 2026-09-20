export type MatchResult = 'black' | 'white' | 'draw'

export type Stats = {
  version: 1
  totalGames: number
  blackWins: number
  whiteWins: number
  draws: number
}

const STORAGE_KEY = 'hyomes:omok:stats:v1'
const EMPTY_STATS: Stats = { version: 1, totalGames: 0, blackWins: 0, whiteWins: 0, draws: 0 }

function isStats(value: unknown): value is Stats {
  if (!value || typeof value !== 'object') return false
  const stats = value as Partial<Stats>
  return stats.version === 1 && [stats.totalGames, stats.blackWins, stats.whiteWins, stats.draws]
    .every((number) => Number.isInteger(number) && Number(number) >= 0)
}

export function loadStats(): Stats {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return { ...EMPTY_STATS }
    const parsed: unknown = JSON.parse(stored)
    return isStats(parsed) ? parsed : { ...EMPTY_STATS }
  } catch {
    return { ...EMPTY_STATS }
  }
}

function saveStats(stats: Stats) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats))
  } catch {
    // A finished game should remain playable even if storage is unavailable.
  }
}

export function recordResult(result: MatchResult): Stats {
  const current = loadStats()
  const next: Stats = {
    ...current,
    totalGames: current.totalGames + 1,
    blackWins: current.blackWins + (result === 'black' ? 1 : 0),
    whiteWins: current.whiteWins + (result === 'white' ? 1 : 0),
    draws: current.draws + (result === 'draw' ? 1 : 0),
  }
  saveStats(next)
  return next
}

export function clearStats(): Stats {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Return a clean in-memory value if storage is unavailable.
  }
  return { ...EMPTY_STATS }
}
