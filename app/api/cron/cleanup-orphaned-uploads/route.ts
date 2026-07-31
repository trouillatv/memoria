// Cron de nettoyage des uploads orphelins (> 72h en statut 'pending')
//
// Doctrine :
//   Un upload 'pending' depuis > 72h est considéré comme abandonné.
//   Le fichier Storage est supprimé (si présent), l'enregistrement passe à 'failed'.
//
// Sécurité :
//   - Les uploads 'confirmed' ne sont JAMAIS supprimés
//   - Fichier déjà absent = succès (idempotent)
//   - Erreur de suppression = loggée mais ne bloque pas le lot
//
// Vercel cron : 0 2 * * * (tous les jours à 2h du matin)

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { listOrphanedUploads, markUploadAsFailed } from '@/lib/db/historical-pv-uploads'

const STORAGE_BUCKET = 'documents'

export async function GET(req: NextRequest) {
  // Vérification du secret Vercel cron
  const authHeader = req.headers.get('authorization')
  const expectedAuth = `Bearer ${process.env.CRON_SECRET}`
  if (!process.env.CRON_SECRET || authHeader !== expectedAuth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startTime = Date.now()
  const adminSupabase = createAdminClient()
  let cleanedCount = 0
  let errorCount = 0
  const errors: string[] = []

  try {
    // Récupère les uploads orphelins (> 72h en 'pending')
    const orphans = await listOrphanedUploads(72)

    console.log(`[cleanup-orphaned-uploads] Found ${orphans.length} orphaned uploads`)

    for (const orphan of orphans) {
      try {
        // 1. Supprimer le fichier Storage (idempotent : ne fail pas si déjà absent)
        const { error: removeError } = await adminSupabase.storage
          .from(STORAGE_BUCKET)
          .remove([orphan.storagePath])

        if (removeError) {
          // Fichier déjà absent ou erreur de suppression → logger mais continuer
          console.warn(`[cleanup-orphaned-uploads] Storage removal warning for ${orphan.id}:`, removeError.message)
        }

        // 2. Marquer comme 'failed' avec raison explicite
        await markUploadAsFailed(
          orphan.id,
          `Nettoyage automatique : upload abandonné depuis > 72h (créé le ${orphan.createdAt})`,
        )

        cleanedCount++
      } catch (e) {
        errorCount++
        const errorMsg = `Upload ${orphan.id}: ${e instanceof Error ? e.message : String(e)}`
        errors.push(errorMsg)
        console.error(`[cleanup-orphaned-uploads] Error cleaning upload ${orphan.id}:`, e)
        // Continue le lot même en cas d'erreur sur un upload
      }
    }

    const duration = Date.now() - startTime

    console.log(`[cleanup-orphaned-uploads] Completed: ${cleanedCount} cleaned, ${errorCount} errors, ${duration}ms`)

    return NextResponse.json({
      ok: true,
      total: orphans.length,
      cleaned: cleanedCount,
      errors: errorCount,
      errorDetails: errors.slice(0, 10), // Limite à 10 premiers messages
      durationMs: duration,
    })
  } catch (e) {
    console.error('[cleanup-orphaned-uploads] Fatal error:', e)
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : 'Unknown error',
      },
      { status: 500 },
    )
  }
}
