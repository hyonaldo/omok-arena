import { describe, expect, it } from 'vitest'
import { MIN_REQUEST_GAP_MS, RequestPacer } from '../pacer'

describe('RequestPacer', () => {
  it('lets the very first request go immediately', () => {
    const pacer = new RequestPacer(() => 10_000)
    expect(pacer.delayBeforeNext()).toBe(0)
  })

  it('spaces consecutive requests by at least the minimum gap', () => {
    let now = 10_000
    const pacer = new RequestPacer(() => now)
    pacer.markSent()
    now += 400
    expect(pacer.delayBeforeNext()).toBe(MIN_REQUEST_GAP_MS - 400)
    now += MIN_REQUEST_GAP_MS
    expect(pacer.delayBeforeNext()).toBe(0)
  })

  it('honours a server Retry-After even when it is longer than the minimum gap', () => {
    let now = 10_000
    const pacer = new RequestPacer(() => now)
    pacer.markSent()
    pacer.backOff(12)
    expect(pacer.delayBeforeNext()).toBe(12_000)
    now += 5_000
    expect(pacer.delayBeforeNext()).toBe(7_000)
  })

  it('clears the back-off once a request succeeds', () => {
    let now = 10_000
    const pacer = new RequestPacer(() => now)
    pacer.markSent()
    pacer.backOff(30)
    now += MIN_REQUEST_GAP_MS
    pacer.markSent()
    expect(pacer.delayBeforeNext()).toBe(MIN_REQUEST_GAP_MS)
  })
})
