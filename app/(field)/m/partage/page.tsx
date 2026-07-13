// « Vous avez partagé 6 photos. Sur quel chantier ? »
//
// L'écran qui manquait. Guillaume ne cherche plus ses fichiers dans Android :
// il les voit, il choisit le chantier, c'est importé.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { listStaged, signStaged } from '@/lib/share/staging'
import { describeLot, describeLotFr } from '@/lib/share/share-rules'
import { listMeetingSitesAction } from '../meeting-actions'
import { lastShareTargetAction } from './share-actions'
import { SharePicker } from './SharePicker'

export const dynamic = 'force-dynamic'

const ERREURS: Record<string, string> = {
  'trop-lourd':
    'Trop lourd pour un partage (les vidéos pèsent vite). Envoyez-en moins, ou passez par « Importer » depuis le chantier.',
  vide: 'Aucun fichier n’est arrivé.',
  type: 'Ce type de fichier ne peut pas être partagé ici — photos, enregistrements, vidéos et PDF.',
  stockage: 'Les fichiers ne sont pas arrivés jusqu’au bout. Réessayez.',
}

export default async function PartagePage({
  searchParams,
}: {
  searchParams: Promise<{ lot?: string; erreur?: string }>
}) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')

  const { lot, erreur } = await searchParams

  // Un partage qui a échoué : on le DIT, on ne renvoie pas sur un écran vide.
  if (!lot) {
    return (
      <div className="mx-auto w-full max-w-md space-y-4 p-4">
        <h1 className="text-lg font-semibold">Partager vers MemorIA</h1>
        <p className="inline-flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {ERREURS[erreur ?? ''] ??
            'Depuis WhatsApp (ou la galerie), utilisez « Partager » puis choisissez MemorIA.'}
        </p>

        {/* Ce n'est PAS un bug de MemorIA, et aucune application web ne peut le
            contourner : c'est le menu de WhatsApp. Le dire évite de chercher un
            bouton qui n'existera jamais. */}
        <p className="rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
          Dans WhatsApp, si vous sélectionnez <strong>plusieurs messages</strong>, « Partager »
          disparaît — il ne reste que « Transférer », qui garde tout chez WhatsApp. Partagez donc{' '}
          <strong>un élément à la fois</strong> : MemorIA vous proposera d’ajouter chacun à la même
          visite, en un seul geste. Depuis la galerie Android, plusieurs fichiers à la fois
          fonctionnent normalement.
        </p>
        <Link href="/m" className="inline-block text-sm font-medium text-brand-700 hover:underline">
          Retour à mes chantiers
        </Link>
      </div>
    )
  }

  const staged = await listStaged(user.id, lot)
  if (staged.length === 0) {
    return (
      <div className="mx-auto w-full max-w-md space-y-4 p-4">
        <h1 className="text-lg font-semibold">Partager vers MemorIA</h1>
        <p className="rounded-xl border bg-muted/30 p-3 text-sm text-muted-foreground">
          Ces photos ne sont plus disponibles. Repartagez-les depuis WhatsApp.
        </p>
        <Link href="/m" className="inline-block text-sm font-medium text-brand-700 hover:underline">
          Retour à mes chantiers
        </Link>
      </div>
    )
  }

  const [urls, sites, last] = await Promise.all([
    signStaged(staged.map((f) => f.path)),
    listMeetingSitesAction().catch(() => [] as Array<{ id: string; name: string }>),
    // WhatsApp n'autorise qu'un partage à la fois : la 2ᵉ photo doit rejoindre
    // la 1ʳᵉ en UN geste, pas en trois.
    lastShareTargetAction().catch(() => null),
  ])

  return (
    <SharePicker
      lotId={lot}
      files={staged.map((f) => ({
        path: f.path,
        filename: f.filename,
        mime: f.mime,
        url: urls[f.path] ?? null,
      }))}
      sites={sites}
      // « 3 photos et 2 enregistrements » — jamais « 5 fichiers ».
      lotLabel={describeLotFr(describeLot(staged.map((f) => f.mime)))}
      last={last}
    />
  )
}
