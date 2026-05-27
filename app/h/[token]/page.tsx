// URL publique /h/[token] — Consultation anonyme d'un brief de passage de témoin.
//
// Vincent 2026-05-22 — Sprint Équipes C + polish D' (mobile-first + sommaire +
// acknowledged sans login + Open Graph).
//
// Pattern aligné sur /p/[token] (proof_share_tokens) :
//   - Force-dynamic (jamais cacher : un revoke / expiration doit être effectif)
//   - 4 états : 404 / archivé / expiré / actif
//   - Audit silencieux (incrémente access_count + last_accessed_at)
//   - Pas de cookies, pas d'analytics tiers
//   - Liens internes désactivés (publicView=true)
//
// Polish D' :
//   - Layout mobile-first absolu (lu sur téléphone à 5h30 sous parking)
//   - Sommaire cliquable si plusieurs sites (scroll to anchor)
//   - Bouton "C'est lu, j'ai compris" → bascule acknowledged sans login
//   - Open Graph metadata propre pour prévisualisation WhatsApp/Slack/SMS
//
// Doctrine [[brief-moment-magique]] : c'est la vitrine du produit, pas un
// détail UX.

import { ShieldCheck, ShieldX, Clock, ArrowRightLeft, MapPin, FileDown } from 'lucide-react'
import type { Metadata } from 'next'
import {
  getHandoverBriefByToken,
  recordHandoverShareAccess,
} from '@/lib/db/handover'
import { HandoverPayloadView } from '@/app/(dashboard)/handovers/HandoverPayloadView'
import { PublicAcknowledgeButton } from './PublicAcknowledgeButton'

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

// ─── Metadata Open Graph (prévisualisation WhatsApp/Slack/iMessage) ──────────
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params
  const brief = await getHandoverBriefByToken(token)
  if (!brief || brief.deleted_at) {
    return {
      title: 'Lien introuvable — MemorIA',
      description: 'Ce lien de partage n’existe pas ou a été révoqué.',
    }
  }
  const expired = brief.expires_at != null && new Date(brief.expires_at) < new Date()
  if (expired) {
    return {
      title: 'Lien expiré — MemorIA',
      description: 'Ce lien de partage a expiré.',
    }
  }
  const sitesCount = brief.payload?.sites?.length ?? 0
  const description = sitesCount === 0
    ? 'Brief de passage de témoin'
    : `${sitesCount} site${sitesCount > 1 ? 's' : ''} · mémoire transmise par MemorIA`
  return {
    title: `${brief.title} — MemorIA`,
    description,
    openGraph: {
      title: brief.title,
      description,
      type: 'article',
      siteName: 'MemorIA',
    },
    robots: { index: false, follow: false }, // pages publiques mais non indexées
  }
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

  const sites = brief.payload?.sites ?? []
  const showToc = sites.length > 1
  const alreadyAcknowledged = brief.status === 'acknowledged'

  return (
    <PublicShell>
      {/* Header sobre — sticky en mobile pour qu'on garde le contexte */}
      <header className="rounded-lg border-2 border-brand-200 bg-brand-50/50 dark:bg-brand-950/20 p-4 sm:p-5 space-y-2">
        <div className="flex items-center gap-2 text-xs text-brand-700 dark:text-brand-300 flex-wrap">
          <ShieldCheck className="h-4 w-4 shrink-0" />
          <span className="font-medium">Lien authentique MemorIA</span>
          <span className="text-muted-foreground">·</span>
          <ArrowRightLeft className="h-3 w-3 shrink-0" />
          <span>{KIND_LABEL[brief.kind] ?? brief.kind}</span>
        </div>
        <h1 className="text-xl sm:text-2xl font-semibold leading-tight">{brief.title}</h1>
        {brief.effective_date && (
          <p className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-800 dark:text-amber-200">
            <Clock className="h-3.5 w-3.5" />
            Effectif à partir du {brief.effective_date.split('-').reverse().join('/')}
          </p>
        )}
        <a
          href={`/h/${token}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs rounded-md border bg-background px-2.5 h-8 text-muted-foreground transition-[colors,transform] hover:text-foreground hover:bg-muted active:scale-[0.97]"
        >
          <FileDown className="h-3.5 w-3.5" />
          Télécharger le PDF (imprimable)
        </a>
      </header>

      {/* Sommaire cliquable — uniquement si plusieurs sites */}
      {showToc && (
        <nav
          aria-label="Sommaire des sites concernés"
          className="rounded-lg border bg-card p-3 sm:p-4 space-y-2"
        >
          <p className="text-xs font-medium text-muted-foreground">
            Aller directement à :
          </p>
          <ul className="flex flex-wrap gap-2">
            {sites.map((s, i) => (
              <li key={s.site_id}>
                <a
                  href={`#site-${s.site_id}`}
                  className="inline-flex items-center gap-1.5 text-xs rounded-full border bg-background px-3 py-1.5 hover:bg-muted/60 hover:border-brand-300 transition-colors"
                >
                  <MapPin className="h-3 w-3 text-brand-600" />
                  <span>{s.site_name}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {/* Payload — vue server avec ancres sur les sites */}
      <HandoverPayloadView payload={brief.payload} publicView={true} />

      {/* Bouton "C'est lu" — uniquement si pas déjà reconnu */}
      <div className="rounded-lg border bg-card p-4 sm:p-5 space-y-3 text-center">
        {alreadyAcknowledged ? (
          <p className="text-sm text-emerald-700 dark:text-emerald-300 inline-flex items-center justify-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            Ce brief a déjà été marqué comme lu et compris.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Quand tu as parcouru le brief et que tu te sens prêt(e), confirme-le.
            </p>
            <PublicAcknowledgeButton token={token} />
            <p className="text-[11px] text-muted-foreground italic">
              Ton clic est tracé côté MemorIA — l’expéditeur saura que tu as bien
              lu et que tu es prêt(e) à reprendre la suite.
            </p>
          </>
        )}
      </div>

      {/* Footer */}
      <footer className="text-center space-y-1 py-4 sm:py-6 border-t">
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
// Shell + erreur
// ----------------------------------------------------------------------------

function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-3 sm:px-4 py-4 sm:py-8 space-y-4 sm:space-y-6">
        {children}
      </div>
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
    <div className="rounded-lg border bg-card p-6 sm:p-8 text-center space-y-3">
      <Icon className="h-10 w-10 sm:h-12 sm:w-12 mx-auto text-muted-foreground" />
      <h1 className="text-base sm:text-lg font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">{description}</p>
      <p className="text-[11px] text-muted-foreground italic pt-2">
        MemorIA — Mémoire opérationnelle augmentée
      </p>
    </div>
  )
}
