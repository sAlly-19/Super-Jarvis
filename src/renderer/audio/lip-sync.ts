export interface LipSyncTargets {
  jawOpen: number
  mouthFunnel: number
  mouthPucker: number
  mouthStretchLeft: number
  mouthStretchRight: number
  mouthSmileLeft: number
  mouthSmileRight: number
  mouthClose: number
}

export class LipSyncAnalyzer {
  private analyser: AnalyserNode | null = null
  private freqData: Uint8Array<ArrayBuffer> | null = null
  private currentWeights: LipSyncTargets = {
    jawOpen: 0,
    mouthFunnel: 0,
    mouthPucker: 0,
    mouthStretchLeft: 0,
    mouthStretchRight: 0,
    mouthSmileLeft: 0,
    mouthSmileRight: 0,
    mouthClose: 0
  }

  // Dynamic automatic gain control (AGC) & syllable tracking
  private peakVolume = 0.12
  private previousVolume = 0

  constructor(analyser: AnalyserNode | null = null) {
    if (analyser) {
      this.setAnalyser(analyser)
    }
  }

  public setAnalyser(analyser: AnalyserNode): void {
    this.analyser = analyser
    this.freqData = new Uint8Array(analyser.frequencyBinCount)
  }

  private lerp(start: number, end: number, t: number): number {
    return start + (end - start) * t
  }

  /**
   * Evaluates audio frequency bands and returns smoothed, anatomically natural ARKit blendshape weights.
   * Ensures the mouth articulates open/close cadences instead of freezing wide open.
   */
  public update(): LipSyncTargets {
    if (!this.analyser || !this.freqData) {
      this.decayToZero()
      return this.currentWeights
    }

    this.analyser.getByteFrequencyData(this.freqData)
    const binCount = this.freqData.length
    const sampleRate = this.analyser.context.sampleRate
    const hzPerBin = sampleRate / (binCount * 2)

    // Calculate energy across key frequency bands
    let totalSum = 0
    for (let i = 0; i < binCount; i++) {
      totalSum += this.freqData[i]
    }
    const currentVolume = totalSum / binCount / 255

    // Silence threshold - quickly close mouth when audio drops
    if (currentVolume < 0.018) {
      this.decayToZero()
      this.previousVolume = currentVolume
      return this.currentWeights
    }

    // Adaptive peak tracking for dynamic contrast across different speaking volumes
    if (currentVolume > this.peakVolume) {
      this.peakVolume = currentVolume
    } else {
      this.peakVolume = Math.max(0.08, this.peakVolume * 0.992)
    }

    const normalizedVol = Math.min(1.0, currentVolume / this.peakVolume)

    const getBandEnergy = (startHz: number, endHz: number): number => {
      const startBin = Math.max(0, Math.floor(startHz / hzPerBin))
      const endBin = Math.min(binCount - 1, Math.floor(endHz / hzPerBin))
      if (startBin >= endBin) return 0

      let sum = 0
      for (let i = startBin; i <= endBin; i++) {
        sum += this.freqData![i]
      }
      return sum / (endBin - startBin + 1) / 255
    }

    // 1. Low vowels / fundamental voice resonance (100 - 650 Hz)
    const lowEnergy = getBandEnergy(100, 650)
    // 2. Round vowels (650 - 1800 Hz): 'O', 'U', 'A'
    const midEnergy = getBandEnergy(650, 1800)
    // 3. Sibilants & plosives (1800 - 4500 Hz): Consonants 'S', 'T', 'CH', 'F', 'P'
    const highEnergy = getBandEnergy(1800, 4500)

    const volumeDelta = currentVolume - this.previousVolume
    this.previousVolume = currentVolume

    // Consonant / syllable boundary detection:
    // When high frequencies spike or volume drops between syllables, the jaw must articulate closed
    const isConsonant = highEnergy > lowEnergy * 0.95 || (volumeDelta < -0.035 && currentVolume < this.peakVolume * 0.45)

    // --- ARTICULATION WEIGHTS ---
    // 1. Jaw Opening: Maximum conversational speech opening is 0.20 - 0.22 (never 0.48!)
    let targetJawOpen = 0
    if (!isConsonant && normalizedVol > 0.06) {
      // Power curve creates sharp contrast between open vowels and closed consonants
      const vowelStrength = Math.pow(normalizedVol, 1.35)
      targetJawOpen = Math.min(0.20, vowelStrength * 0.18 + lowEnergy * 0.06)
    } else {
      // Near zero during consonants so mouth visibly closes
      targetJawOpen = Math.max(0, normalizedVol * 0.04)
    }

    // 2. Round vs Spread Vowels
    let targetFunnel = 0
    let targetPucker = 0
    let targetStretch = 0
    let targetClose = 0

    if (midEnergy > highEnergy * 1.2 && !isConsonant) {
      // Rounded vowels ('O', 'U')
      targetFunnel = Math.min(0.22, midEnergy * 0.45)
      targetPucker = Math.min(0.16, midEnergy * 0.30)
    } else if (highEnergy > midEnergy * 1.1) {
      // Spread vowels ('E', 'I') and sibilants
      targetStretch = Math.min(0.20, highEnergy * 0.40)
    }

    // 3. Bilabial closure on consonant stops (P, B, M)
    if (isConsonant && currentVolume > 0.025 && targetJawOpen < 0.08) {
      targetClose = 0.22
    }

    // Fast attack (opens on syllables) and rapid decay (closes between syllables)
    const attack = 0.48
    const decay = 0.35

    const smoothStep = (curr: number, target: number): number => {
      const factor = target > curr ? attack : decay
      return this.lerp(curr, target, factor)
    }

    this.currentWeights.jawOpen = smoothStep(this.currentWeights.jawOpen, targetJawOpen)
    this.currentWeights.mouthFunnel = smoothStep(this.currentWeights.mouthFunnel, targetFunnel)
    this.currentWeights.mouthPucker = smoothStep(this.currentWeights.mouthPucker, targetPucker)
    this.currentWeights.mouthStretchLeft = smoothStep(this.currentWeights.mouthStretchLeft, targetStretch)
    this.currentWeights.mouthStretchRight = smoothStep(this.currentWeights.mouthStretchRight, targetStretch)
    this.currentWeights.mouthClose = smoothStep(this.currentWeights.mouthClose, targetClose)

    return this.currentWeights
  }

  private decayToZero(): void {
    const decayFactor = 0.35
    this.currentWeights.jawOpen = this.lerp(this.currentWeights.jawOpen, 0, decayFactor)
    this.currentWeights.mouthFunnel = this.lerp(this.currentWeights.mouthFunnel, 0, decayFactor)
    this.currentWeights.mouthPucker = this.lerp(this.currentWeights.mouthPucker, 0, decayFactor)
    this.currentWeights.mouthStretchLeft = this.lerp(this.currentWeights.mouthStretchLeft, 0, decayFactor)
    this.currentWeights.mouthStretchRight = this.lerp(this.currentWeights.mouthStretchRight, 0, decayFactor)
    this.currentWeights.mouthSmileLeft = this.lerp(this.currentWeights.mouthSmileLeft, 0, decayFactor)
    this.currentWeights.mouthSmileRight = this.lerp(this.currentWeights.mouthSmileRight, 0, decayFactor)
    this.currentWeights.mouthClose = this.lerp(this.currentWeights.mouthClose, 0, decayFactor)
  }

  public reset(): void {
    this.currentWeights = {
      jawOpen: 0,
      mouthFunnel: 0,
      mouthPucker: 0,
      mouthStretchLeft: 0,
      mouthStretchRight: 0,
      mouthSmileLeft: 0,
      mouthSmileRight: 0,
      mouthClose: 0
    }
    this.previousVolume = 0
  }
}
