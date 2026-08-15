import { describe, it, expect } from 'vitest'
import { createVad, clampThreshold, DEFAULT_VAD_CONFIG, type VadSignal } from '@/lib/voice/vad'

// 60 fps : c'est la cadence du RAF qui alimente la VAD dans l'orbe.
const FRAME = 16
const T0 = 1_000

// Niveaux sur l'échelle normalisée [0,1] de l'orbe (`--audio-delta`), pas en
// RMS brut. Voir l'en-tête de lib/voice/vad.ts.
const SILENCE = 0.01
const BRUIT_BUREAU = 0.02
const BRUIT_CHANTIER = 0.18
const VOIX = 0.5

type Segment = { level: number; ms: number }

/** Rejoue une suite de segments frame par frame et collecte les signaux émis. */
function drive(segments: Segment[], startMs = T0) {
  const vad = createVad(startMs)
  const signals: Array<{ signal: VadSignal; atMs: number }> = []
  let now = startMs
  for (const seg of segments) {
    for (let i = 0; i < Math.round(seg.ms / FRAME); i++) {
      const s = vad.push(seg.level, now)
      if (s) signals.push({ signal: s, atMs: now })
      now += FRAME
    }
  }
  return { vad, signals, endMs: now }
}

/** ~500 ms de fond sonore : la calibration a besoin de 30 frames. */
const calibration = (level = BRUIT_BUREAU): Segment => ({ level, ms: 520 })

describe('createVad — calibration du bruit', () => {
  it('n’arme rien tant que le fond sonore n’est pas mesuré', () => {
    const vad = createVad(T0)
    for (let i = 0; i < 10; i++) vad.push(VOIX, T0 + i * FRAME)
    expect(vad.snapshot()).toMatchObject({ phase: 'calibrating', threshold: null })
  })

  it('en pièce calme, retombe sur le seuil de départ 0,10', () => {
    const { vad } = drive([calibration(SILENCE)])
    expect(vad.snapshot().threshold).toBe(0.1)
  })

  it('relève le seuil dans un environnement bruyant, sans dépasser la borne haute', () => {
    const { vad } = drive([calibration(BRUIT_CHANTIER)])
    const seuil = vad.snapshot().threshold!
    expect(seuil).toBeGreaterThan(0.1)
    expect(seuil).toBeLessThanOrEqual(DEFAULT_VAD_CONFIG.maxThreshold)
    // Un bruit de chantier continu ne doit jamais être lu comme de la parole…
    expect(BRUIT_CHANTIER).toBeLessThan(seuil)
    // …mais la voix, elle, doit encore franchir le seuil.
    expect(VOIX).toBeGreaterThan(seuil)
  })

  it('borne le seuil des deux côtés', () => {
    expect(clampThreshold(0)).toBe(DEFAULT_VAD_CONFIG.minThreshold)
    expect(clampThreshold(1)).toBe(DEFAULT_VAD_CONFIG.maxThreshold)
  })
})

describe('createVad — fin de parole', () => {
  it('aucune parole : abandonne au bout du délai, sans jamais conclure une phrase', () => {
    const { signals } = drive([calibration(), { level: BRUIT_BUREAU, ms: 7_000 }])
    expect(signals.map((s) => s.signal)).toEqual(['no-speech'])
    expect(signals[0].atMs - T0).toBeGreaterThanOrEqual(DEFAULT_VAD_CONFIG.noSpeechTimeoutMs)
  })

  it('une micro-pause d’environ 1 s au milieu d’une phrase ne coupe pas', () => {
    const { signals } = drive([
      calibration(),
      { level: VOIX, ms: 900 },      // « Quels sont les prochains points de contrôle »
      { level: SILENCE, ms: 1_000 }, // hésitation
      { level: VOIX, ms: 900 },      // « sur le chantier PETRO ATITI ? »
      { level: SILENCE, ms: 1_500 }, // fin réelle
    ])
    expect(signals.map((s) => s.signal)).toEqual(['speech-ended'])
    // Le signal tombe après la seconde moitié de phrase, pas pendant la pause.
    expect(signals[0].atMs - T0).toBeGreaterThan(520 + 900 + 1_000 + 900)
  })

  it('silence final : conclut une fois et devient inerte', () => {
    const { vad, signals } = drive([
      calibration(),
      { level: VOIX, ms: 1_200 },
      { level: SILENCE, ms: 5_000 }, // très au-delà de la fenêtre de silence
    ])
    expect(signals).toHaveLength(1)
    expect(signals[0].signal).toBe('speech-ended')
    expect(vad.snapshot()).toMatchObject({ phase: 'done', speechDetected: true })
    // Toute frame ultérieure est sans effet.
    expect(vad.push(VOIX, T0 + 60_000)).toBeNull()
  })

  it('ignore un bruit bref qui ne dure pas assez pour être de la parole', () => {
    const { vad, signals } = drive([
      calibration(),
      { level: VOIX, ms: 100 }, // claquement de porte, sous speechOnsetMs
      { level: BRUIT_BUREAU, ms: 3_000 },
    ])
    expect(signals).toHaveLength(0)
    expect(vad.snapshot()).toMatchObject({ phase: 'waiting', speechDetected: false })
  })

  it('coupe au garde-fou de durée maximale si la parole ne s’arrête jamais', () => {
    const { signals } = drive([calibration(), { level: VOIX, ms: 31_000 }])
    expect(signals.map((s) => s.signal)).toEqual(['max-duration'])
    expect(signals[0].atMs - T0).toBeGreaterThanOrEqual(DEFAULT_VAD_CONFIG.maxDurationMs)
  })
})
