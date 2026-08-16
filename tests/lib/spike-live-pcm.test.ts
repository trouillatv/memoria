// @vitest-environment node
/**
 * P3-A — encodage PCM envoyé à Gemini Live.
 *
 * Ce test ne protège pas une fonctionnalité produit : il protège une CONCLUSION.
 * Le banc `/m/spike-voice` doit trancher si Gemini Live entre dans
 * l'architecture. Si le PCM part corrompu, Live transcrit du bruit, « PETRO
 * ATITI » ressort faux, et on fermerait la piste en accusant le modèle. Rien à
 * l'écran ne distinguerait ce cas d'un vrai échec du moteur.
 *
 * Contrat vérifié : 16 bits signés, LITTLE-ENDIAN, sans octet perdu ni ajouté —
 * c'est ce qu'annonce `audio/pcm;rate=16000`.
 */
import { describe, it, expect } from 'vitest'
import { pcmToBase64 } from '@/app/(field)/m/spike-voice/SpikeVoiceHarness'

function decode(b64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(b64, 'base64'))
}

describe('pcmToBase64 — trame envoyée à Gemini Live', () => {
  it('encode en little-endian, deux octets par échantillon', () => {
    // 0x0102 → octets 02 01 si little-endian, 01 02 si big-endian.
    const bytes = decode(pcmToBase64(Int16Array.from([0x0102])))
    expect(Array.from(bytes)).toEqual([0x02, 0x01])
  })

  it('conserve les valeurs négatives (complément à deux)', () => {
    const bytes = decode(pcmToBase64(Int16Array.from([-1, -32768])))
    expect(Array.from(bytes)).toEqual([0xff, 0xff, 0x00, 0x80])
  })

  it('restitue exactement le bloc de 40 ms, sans troncature ni bourrage', () => {
    // 640 échantillons à 16 kHz = 40 ms, la taille réellement émise par le
    // worklet. Un « off-by-one » sur la dernière tranche passerait inaperçu sur
    // un tableau court.
    const src = Int16Array.from({ length: 640 }, (_, i) => ((i * 517) % 65536) - 32768)
    const bytes = decode(pcmToBase64(src))
    expect(bytes.byteLength).toBe(1280)
    const back = new Int16Array(bytes.buffer, bytes.byteOffset, 640)
    expect(Array.from(back)).toEqual(Array.from(src))
  })

  it('reste exact au-delà de la tranche interne de 0x8000 octets', () => {
    // La boucle découpe par 32 768 octets pour ne pas saturer la pile
    // d'arguments ; la jointure entre deux tranches est le point fragile.
    const src = Int16Array.from({ length: 40_000 }, (_, i) => (i % 2 === 0 ? i % 32767 : -(i % 32767)))
    const bytes = decode(pcmToBase64(src))
    expect(bytes.byteLength).toBe(80_000)
    const back = new Int16Array(bytes.buffer, bytes.byteOffset, src.length)
    expect(Array.from(back)).toEqual(Array.from(src))
  })
})
