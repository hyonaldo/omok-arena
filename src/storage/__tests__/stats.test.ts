import { beforeEach, describe, expect, it } from 'vitest'
import { clearStats, loadStats, recordResult } from '../stats'

describe('stats storage', () => {
  beforeEach(() => localStorage.clear())

  it('starts at zero and records black, white, and draw results', () => {
    expect(loadStats()).toEqual({ version: 1, totalGames: 0, blackWins: 0, whiteWins: 0, draws: 0 })
    recordResult('black')
    recordResult('white')
    recordResult('draw')
    expect(loadStats()).toEqual({ version: 1, totalGames: 3, blackWins: 1, whiteWins: 1, draws: 1 })
  })

  it('falls back safely when stored data is corrupt', () => {
    localStorage.setItem('hyomes:omok:stats:v1', '{bad json')
    expect(loadStats().totalGames).toBe(0)
  })

  it('can clear the cumulative record', () => {
    recordResult('black')
    clearStats()
    expect(loadStats().totalGames).toBe(0)
  })
})
