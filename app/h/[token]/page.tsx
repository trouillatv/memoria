// URL publique /h/[token] — Consultation anonyme d'un brief de passage de témoin.
//
// Vincent 2026-05-22 — Sprint Équipes C.
//
// Pattern aligné sur /p/[token] (proof_share_tokens) :
//   - Force-dynamic (jamais cacher : un revoke / expiration doit être effectif)
//   - 4 états : 404 / expiré / archivé / actif
//   - Audit silencieux (incrémente access_count + last_accessed_at)
//   - Pas de cookies, pas d'analytics tiers
//   - Liens internes désactivés (publicView=true)
//
// Doctrine : le visiteur (chef d'équipe / agent qui prend la suite) voit
// EXACTEMENT le snapshot qui lui a été préparé. Pas de header dashboard, pas
// de navigation latérale — vue épurée pour transmission.

import { ShieldCheck, ShieldX, Clock, ArrowRightLeft } from 'lucide-react'
import {
  getHandoverBriefByToken,
  recordHandoverShareAccess,
} from '@/lib/db/handover'
import { HandoverPayloadView } from '@/app/(dashboard)/handovers/HandoverPayloadView'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const KIND_LABEL: Record<string, string> = {
  member_change: 'Changement d’équipe',
  team_takes_site: 'Prise de site',
  manual: 'Brief',
}

interface PageProps {
  params: Promise<{ token: string }>
}

export default async function PublicHandoverPage({ params }: PageProps) {
  const { token } = await params
  const brief = await getHandoverBriefByToken(token)

  // 404 — token inconnu
  if (!brief) {
    return (
      <PublicShell>
        <PublicError
          icon={ShieldX}
          title="Lien introuvable"
          description="Ce lien de partage n’existe pas ou a été révoqué. Demande à l’expéditeur un nouveau lien."
        />
      </PublicShell>
    )
  }

  // Archivé — le brief existe encore mais a été archivé
  if (brief.status === 'archived' || brief.deleted_at) {
    return (
      <PublicShell>
        <PublicError
          icon={ShieldX}
          title="Brief archivé"
          description="Ce brief a été archivé. Si tu en as besoin, demande à son auteur de le réactiver."
        />
      </PublicShell>
    )
  }

  // Expiré
  if (brief.expires_at && new Date(brief.expires_at) < new Date()) {
    return (
      <PublicShell>
        <PublicError
          icon={Clock}
          title="Lien expiré"
          description="Ce lien de partage a expiré. Demande un nouveau lien à l’expéditeur."
        />
      </PublicShell>
    )
  }

  // Actif — log audit silencieux + rendu
  await recordHandoverShareAccess(token)

  return (
    <PublicShell>
      {/* Header sobre */}
      <header className="rounded-lg border-2 border-brand-200 bg-brand-50/50 dark:bg-brand-950/20 p-5 space-y-2">
        <div className="flex items-center gap-2 text-xs text-brand-700 dark:text-brand-300">
          <ShieldCheck className="h-4 w-4" />
          <span className="font-medium">Lien authentique MemorIA</span>
          <span className="text-muted-foreground">·</span>
          <ArrowRightLeft className="h-3 w-3" />
          <span>{KIND_LABEL[brief.kind] ?? brief.kind}</span>
        </div>
        <h1 className="text-2xl font-semibold">{brief.title}</h1>
      </header>

      {/* Payload */}
      <HandoverPayloadView payload={brief.payload} publicView={true} />

      {/* Footer */}
      <footer className="text-center space-y-1 py-6 border-t">
        <p className="text-xs text-muted-foreground">
          MemorIA — Mémoire opérationnelle augmentée
        </p>
        <p className="text-[11px] text-muted-foreground italic">
          Ce brief documente le site et la mémoire utile. Aucune évaluation de
          personne. Lien à usage temporaire — chaque consultation est tracée.
        </p>
      </footer>
    </PublicShell>
  )
}

// ----------------------------------------------------------------------------
// Shell + erreur (composants locaux pour cohérence visuelle simple)
// ----------------------------------------------------------------------------

function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">{children}</div>
    </div>
  )
}

function PublicError({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
}) {
  return (
    <div className="rounded-lg border bg-card p-8 text-center space-y-3">
      <Icon className="h-12 w-12 mx-auto text-muted-foreground" />
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">{description}</p>
      <p className="text-[11px] text-muted-foreground italic pt-2">
        MemorIA — Mémoire opérationnelle augmentée
      </p>
    </div>
  )
}
