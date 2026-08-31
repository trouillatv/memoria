import Link from 'next/link'
import { ArrowLeft, ListTodo } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { requireSiteAccess } from '@/lib/field/site-access'
import { listOpenSiteActions, type SiteActionRow } from '@/lib/db/site-actions'
import { createAdminClient } from '@/lib/supabase/admin'
import { FieldActionsList } from '@/components/actions/FieldActionsList'
import { resolveActionProvenanceLines } from '@/lib/knowledge/action-provenance-cards'
import { getPendingWork } from '@/lib/knowledge/pending-work'
import { SiteTabs } from '@/app/(field)/m/site/[siteId]/SiteTabs'
import { PendingWorkBlock } from './PendingWorkBlock'

export const dynamic = 'force-dynamic'

// Cockpit terrain des actions ouvertes : synthèse en tête (l'ensemble avant le
// détail), puis cartes priorisées. Voir, suivre au quotidien, ou clôturer.
// `?site=<id>` restreint à UN chantier (depuis la fiche : « les 9 actions »
// doivent être atteignables comme un ensemble, pas noyées dans tous les sites).
export default async function FieldActionsPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string }>
}) {
  const { site: siteId } = await searchParams
  const scoped = typeof siteId === 'string' && siteId.length > 0

  // Le scope chantier EST une frontière d'accès : `listOpenSiteActions({siteIds})`
  // fait confiance à l'appelant pour avoir vérifié l'accès en amont (M3-D). Sans
  // ce garde, `?site=<id d'un autre chantier>` fuiterait des actions hors-org.
  let siteName: string | null = null
  let userRole = ''
  if (scoped) {
    const { user } = await requireSiteAccess(siteId!)
    userRole = user.role
    const supabase = createAdminClient()
    const { data } = await supabase.from('sites').select('name').eq('id', siteId).maybeSingle()
    siteName = (data as { name?: string } | null)?.name ?? null
  } else {
    const user = await getCurrentUserWithProfile()
    if (!user) return null
  }

  // DEUX BLOCS, jamais mélangés. Une proposition est du travail humain restant
  // — la cacher laisserait croire qu'il n'y a rien à faire. Mais elle n'est pas
  // exécutable : personne ne s'est engagé. « à confirmer » n'est pas « ouvert ».
  const [actions, pending] = await Promise.all([
    listOpenSiteActions(scoped ? { siteIds: [siteId!] } : undefined).catch(() => [] as SiteActionRow[]),
    getPendingWork(scoped ? { siteIds: [siteId!] } : {}).catch(() => ({ actions: [], deadlines: [] })),
  ])

  // Provenance compacte par carte — structurelle (colonnes FK), résolue en batch.
  // « Pourquoi cette action existe » sans quitter la liste. Échec => pas de ligne.
  const provenance = await resolveActionProvenanceLines(actions).catch(() => ({}))

  return (
    <div className="space-y-6 pb-24">
      <Link
        href={scoped ? `/m/site/${siteId}` : '/m'}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {scoped ? siteName ?? 'Chantier' : 'Accueil'}
      </Link>

      <header className="space-y-1">
        <h1 className="text-xl font-semibold inline-flex items-center gap-2">
          <ListTodo className="h-5 w-5 text-muted-foreground" />
          Actions du chantier
        </h1>
        <p className="text-sm text-muted-foreground">
          {scoped
            ? 'Tous les points ouverts sur ce chantier.'
            : 'Les points à suivre dans le temps — distinct de la mission du jour.'}
        </p>
      </header>

      {/* Scope chantier = même shell de navigation que les autres vues chantier
          (SiteTabs, Actions sélectionné). On NE recrée PAS l'ancienne Route A :
          on rétablit seulement le contexte chantier autour de /m/actions?site=X.
          Vue globale (sans ?site) = pas de pills chantier. */}
      {scoped && <SiteTabs siteId={siteId!} active="actions" userRole={userRole} />}

      {/* Ce qui attend une DÉCISION — au-dessus, parce que c'est ce qu'on ne
          voit nulle part ailleurs. Attention au mot : une proposition ne bloque
          PAS le chantier. Elle bloque la CONNAISSANCE — une action proposée
          empêche seulement l'action d'exister, une décision proposée empêche la
          mémoire de la porter. Le travail du terrain, lui, continue. */}
      <PendingWorkBlock work={pending} />

      {/* Ce qui attend une EXÉCUTION — des engagements pris. */}
      <FieldActionsList actions={actions} scopedSiteId={scoped ? siteId : undefined} provenance={provenance} />
    </div>
  )
}
