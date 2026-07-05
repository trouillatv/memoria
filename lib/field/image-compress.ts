// Compression / redimensionnement AVANT upload (terrain). Une photo de smartphone
// fait 4-12 Mo ; 50 par visite saturent la file IndexedDB, l'upload réseau et le
// PDF. On ramène chaque photo à une taille raisonnable CÔTÉ NAVIGATEUR, avant même
// la mise en file — sans jamais dégrader ce qui compte (lisibilité d'un défaut).
//
// Best-effort et NON destructif : si le décodage échoue (certains HEIC selon le
// navigateur), on renvoie l'original. On ne perd JAMAIS une photo pour cause de
// compression.

const MAX_DIM = 2048 // côté le plus long — largement assez pour lire un défaut
const QUALITY = 0.82 // JPEG : bon compromis netteté / poids (~300-700 Ko)
// En-deçà, une photo déjà petite et légère ne gagne rien à être recompressée.
const SKIP_UNDER_BYTES = 1_200_000

/**
 * Redimensionne (max `maxDim` px) et recompresse une image en JPEG. Renvoie
 * l'original si : ce n'est pas une image, le décodage échoue, ou le résultat
 * serait plus lourd. Corrige l'orientation EXIF (imageOrientation).
 */
export async function compressImageFile(
  file: File,
  maxDim = MAX_DIM,
  quality = QUALITY,
): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const longest = Math.max(bitmap.width, bitmap.height)
    const scale = Math.min(1, maxDim / longest)
    // Déjà petite ET légère : rien à gagner, on garde l'original tel quel.
    if (scale === 1 && file.size <= SKIP_UNDER_BYTES) { bitmap.close?.(); return file }
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) { bitmap.close?.(); return file }
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality))
    if (!blob || blob.size >= file.size) return file // ne jamais alourdir
    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
    return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified })
  } catch {
    return file // décodage impossible → on garde l'original : zéro perte
  }
}
