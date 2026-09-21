// Groq 무료 티어는 분당 요청 수(RPM)에 민감하다. 착수 요청 사이에 최소 간격을 두고,
// 서버가 Retry-After를 돌려주면 그 시간만큼은 반드시 기다린 뒤 재요청한다.
// 시계는 주입 가능해서 테스트에서 실제 시간을 기다리지 않는다.

export const MIN_REQUEST_GAP_MS = 2_200

export class RequestPacer {
  private lastSentAt: number | null = null
  private blockedUntil = 0
  private readonly now: () => number

  constructor(now: () => number = () => Date.now()) {
    this.now = now
  }

  /** 다음 요청을 보내기 전에 기다려야 하는 ms. 0이면 바로 보내도 된다. */
  delayBeforeNext(): number {
    const current = this.now()
    const gapWait = this.lastSentAt === null ? 0 : Math.max(0, this.lastSentAt + MIN_REQUEST_GAP_MS - current)
    const backOffWait = Math.max(0, this.blockedUntil - current)
    return Math.max(gapWait, backOffWait)
  }

  /** 요청을 실제로 보낸 순간 호출. 성공한 요청은 이전 백오프를 해제한다. */
  markSent(): void {
    this.lastSentAt = this.now()
    this.blockedUntil = 0
  }

  /** 서버가 429와 Retry-After(초)를 돌려줬을 때 호출. */
  backOff(retryAfterSeconds: number): void {
    this.blockedUntil = Math.max(this.blockedUntil, this.now() + retryAfterSeconds * 1000)
  }
}
