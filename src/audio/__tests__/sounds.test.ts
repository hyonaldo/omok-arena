import { describe, expect, it } from 'vitest'
import { getSoundPlan } from '../sounds'

describe('game sound plans', () => {
  it('uses a short low wooden tap for a placed stone', () => {
    const plan = getSoundPlan('stone')
    expect(plan).toHaveLength(2)
    expect(plan[0]).toMatchObject({ frequency: 180, duration: 0.035, wave: 'sine' })
    expect(plan.every((tone) => tone.volume <= 0.08)).toBe(true)
  })

  it('uses a restrained rising chord for a victory', () => {
    const plan = getSoundPlan('victory')
    expect(plan.map((tone) => tone.frequency)).toEqual([523.25, 659.25, 783.99])
    expect(plan.map((tone) => tone.delay)).toEqual([0, 0.1, 0.2])
  })

  it('uses a brief confirmation tone for replay', () => {
    expect(getSoundPlan('replay')).toEqual([
      { frequency: 392, duration: 0.07, delay: 0, volume: 0.045, wave: 'sine' },
    ])
  })
})
