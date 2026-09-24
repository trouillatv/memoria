import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireSiteAccess } from '@/lib/field/site-access'
import { getSiteHeaderName } from '@/lib/field/site-header'
import { listDocumentsForTarget } from '@/lib/db/documents'
import { SiteTabs } from '@/app/(field)/m/site/[siteId]/SiteTabs'

// ── ESPACE CHANTIER PERSISTANT (groupe (chantier)) ───────────────────────────
// Le nom du chantier + les pills sont montés ICI, une fois : passer d'une pill à
// l'autre ne recharge QUE le contenu (voir loading.tsx local), jamais cet en-tête.
// Le hub /m/site/[siteId] (Synthèse) reste HORS de ce groupe — c'est l'accueil.
//
// SÉCURITÉ : ce layout appelle bien requireSiteAccess, mais NE remplace PAS la
// garde des pages (un layout ne se réexécute pas à chaque navigation). Chaque
// page garde la sienne ; `cache()` déduplique les deux dans un même rendu.

export default async function ChantierLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ siteId: string }>
}) {
  const { siteId } = await params
  const { user } = await requireSiteAccess(siteId)
  const [siteName, docs] = await Promise.all([
    getSiteHeaderName(siteId),
    user.role === 'admin' || user.role === 'manager'
      ? listDocumentsForTarget('site', siteId).catch(() => [])
      : Promise.resolve([]),
  ])
  const showDocuments = docs.length > 0

  return (
    <>
      <div className="mx-auto max-w-md space-y-3 px-4 pb-1 pt-4">
        <Link
          href={`/m/site/${siteId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground active:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {siteName}
        </Link>
        <SiteTabs siteId={siteId} showDocuments={showDocuments} />
      </div>
      {children}
    </>
  )
}
