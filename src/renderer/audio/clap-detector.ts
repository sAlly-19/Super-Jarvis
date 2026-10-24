/** Local double-transient detector. Not authentication: similar sounds can trigger it. */
export class ClapDetector {
  private noiseFloor = 0.005
  private previousRms = 0
  private pendingAt: number | null = null
  private firstClapAt: number | null = null
  private lastImpulseAt = -Infinity
  private cooldownUntil = -Infinity

  public process(samples: Float32Array, now: number): boolean {
    if (!samples.length || !Number.isFinite(now)) return false
    let energy = 0
    let difference = 0
    let peak = 0
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i]
      if (!Number.isFinite(sample)) return false
      energy += sample * sample
      peak = Math.max(peak, Math.abs(sample))
      if (i) difference += (sample - samples[i - 1]) ** 2
    }
    const rms = Math.sqrt(energy / samples.length)
    const quiet = rms < Math.max(0.025, this.noiseFloor * 2)
    let triggered = false
    if (this.pendingAt !== null) {
      const duration = now - this.pendingAt
      if (duration > 120) {
        this.pendingAt = null
        this.firstClapAt = null
      } else if (quiet) {
        const clapAt = this.pendingAt
        this.pendingAt = null
        if (this.firstClapAt !== null && clapAt - this.firstClapAt >= 180 && clapAt - this.firstClapAt <= 800) {
          triggered = true
          this.firstClapAt = null
          this.cooldownUntil = now + 2500
        } else {
          this.firstClapAt = clapAt
        }
      }
    }
    const impulse = rms >= Math.max(0.04, this.noiseFloor * 4, this.previousRms * 2.5)
      && peak >= 0.2 && peak / rms >= 1.8 && difference / energy >= 0.6
    if (impulse && now >= this.cooldownUntil && now - this.lastImpulseAt >= 150 && this.pendingAt === null) {
      this.pendingAt = now
      this.lastImpulseAt = now
    }
    if (quiet) this.noiseFloor = Math.max(0.001, Math.min(0.03, this.noiseFloor * 0.98 + rms * 0.02))
    this.previousRms = rms
    return triggered
  }
}
