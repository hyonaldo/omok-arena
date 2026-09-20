export type SoundKind = 'stone' | 'victory' | 'replay'

type Tone = {
  frequency: number
  duration: number
  delay: number
  volume: number
  wave: OscillatorType
}

const SOUND_PLANS: Record<SoundKind, Tone[]> = {
  stone: [
    { frequency: 180, duration: 0.035, delay: 0, volume: 0.08, wave: 'sine' },
    { frequency: 115, duration: 0.055, delay: 0.008, volume: 0.045, wave: 'triangle' },
  ],
  victory: [
    { frequency: 523.25, duration: 0.22, delay: 0, volume: 0.055, wave: 'sine' },
    { frequency: 659.25, duration: 0.22, delay: 0.1, volume: 0.05, wave: 'sine' },
    { frequency: 783.99, duration: 0.34, delay: 0.2, volume: 0.055, wave: 'sine' },
  ],
  replay: [
    { frequency: 392, duration: 0.07, delay: 0, volume: 0.045, wave: 'sine' },
  ],
}

let audioContext: AudioContext | null = null

export function getSoundPlan(kind: SoundKind): Tone[] {
  return SOUND_PLANS[kind].map((tone) => ({ ...tone }))
}

export function playSound(kind: SoundKind) {
  if (typeof window === 'undefined' || !window.AudioContext) return

  try {
    audioContext ??= new window.AudioContext()
    if (audioContext.state === 'suspended') void audioContext.resume()
    const baseTime = audioContext.currentTime + 0.005

    for (const tone of SOUND_PLANS[kind]) {
      const start = baseTime + tone.delay
      const end = start + tone.duration
      const oscillator = audioContext.createOscillator()
      const gain = audioContext.createGain()

      oscillator.type = tone.wave
      oscillator.frequency.setValueAtTime(tone.frequency, start)
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(tone.volume, start + 0.006)
      gain.gain.exponentialRampToValueAtTime(0.0001, end)
      oscillator.connect(gain)
      gain.connect(audioContext.destination)
      oscillator.start(start)
      oscillator.stop(end + 0.01)
    }
  } catch {
    // Sound is optional; the game stays playable if audio is unavailable.
  }
}
