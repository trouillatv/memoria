import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowLeft, FileText, Eye, ClipboardList, ListTodo, Images, Brain, ChevronRight,
} from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getVisit, buildVisitCrDoc, type VisitCrDoc } from '@/lib/db/visits'
import { VisitOutputActions } from '../VisitOutputActions'

export const dynamic = 'force-dynamic'

/**
 * « Aperçu du compte-rendu » — PAS un PDF affiché dans le téléphone, PAS un lecteur
 * de document. Une lecture RAPIDE (< 20 s) pour vérifier, avant de quitter le site,
 * que le chantier est correctement documenté : « si quelqu'un ouvre ce dossier
 * demain matin, qu'est-ce qu'il va lire ? ». Le PDF complet reste à un clic.
 * Règle : jamais une section vide — la page se recompose autour du réel.
 */

// Résumé toujours présent : repli déterministe si l'IA n'a rien produit.
function fallbackSummary(doc: VisitCrDoc): string {
  if (doc.objective) return doc.objective
  const parts: string[] = []
  if (doc.constats.length) parts.push(`${doc.constats.length} observation${doc.constats.length > 1 ? 's' : ''}`)
  if (doc.reserves.length) parts.push(`${doc.reserves.length} réserve${doc.reserves.length > 1 ? 's' : ''}`)
  if (doc.actions.length) parts.push(`${doc.actions.length} action${doc.actions.length > 1 ? 's' : ''}`)
  if (doc.photoCount) parts.push(`${doc.photoCount} photo${doc.photoCount > 1 ? 's' : ''}`)
  return parts.length ? `Visite documentée : ${parts.join(', ')}.` : 'Visite enregistrée. Aucun élément particulier relevé.'
}

export default async function VisitCrPreviewPage({
  params,
}: {
  params: Promise<{ reportId: string }>
}) {
  const { reportId } = await params
  const user = await getCurrentUserWithProfile()
  if (!user) return null

  const visit = await getVisit(reportId)
  if (!visit || !visit.site_id) notFound()
  if (visit.organization_id && user.organization_id && visit.organization_id !== user.organization_id) {
    notFound()
  }

  const doc = await buildVisitCrDoc(reportId, user.id)
  if (!doc) notFound()

  const summary = doc.summary?.trim() || fallbackSummary(doc)

  // Observations = les constats retenus, plafonnés (le reste est dans le CR complet).
  const OBS_MAX = 5
  const observations = doc.constats.slice(0, OBS_MAX)
  const obsMore = doc.constats.length - observations.length

  // Médias = un aperçu, pas une galerie. 4 vignettes max, sinon « +N ».
  const mediaTotal = doc.photoCount + doc.videoCount
  const thumbs = mediaTotal > 4 ? doc.photos.slice(0, 3) : doc.photos.slice(0, 4)
  const mediaMore = mediaTotal - thumbs.length

  return (
    <div className="mx-auto min-h-dvh max-w-md space-y-4 px-4 pb-16 pt-5">
      <Link
        href={`/m/visite/${reportId}/recap`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Récap
      </Link>

      <header className="space-y-0.5">
        <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">Aperçu du compte-rendu</p>
        <h1 className="text-xl font-semibold">{doc.siteName}</h1>
        <p className="text-sm text-muted-foreground first-letter:uppercase">{doc.dateLabel}</p>
      </header>

      {/* 📝 Résumé — 3 à 6 lignes, puis le CR complet à un clic. */}
      <Section Icon={FileText} cls="text-emerald-600" ring="bg-emerald-100 dark:bg-emerald-950/40" title="Résumé">
        <p className="line-clamp-6 whitespace-pre-line text-[13px] leading-relaxed text-foreground/90">{summary}</p>
        <a
          href={`/m/visite/${reportId}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2.5 inline-flex items-center gap-0.5 text-sm font-medium text-emerald-700"
        >
          Voir le compte-rendu complet <ChevronRight className="h-4 w-4" />
        </a>
      </Section>

      {/* 👀 Observations principales — seulement les importantes. */}
      {observations.length > 0 && (
        <Section Icon={Eye} cls="text-sky-600" ring="bg-sky-100 dark:bg-sky-950/40" title="Observations principales">
          <ul className="space-y-1.5">
            {observations.map((o, i) => (
              <li key={i} className="flex gap-2 text-[13px] leading-snug text-foreground/90">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-sky-500" />
                <span className="min-w-0">{o}</span>
              </li>
            ))}
          </ul>
          {obsMore > 0 && (
            <p className="mt-1.5 text-[12px] text-muted-foreground">+{obsMore} autre{obsMore > 1 ? 's' : ''} dans le compte-rendu complet</p>
          )}
        </Section>
      )}

      {/* ⚠️ Réserves — si elles existent. */}
      {doc.reserves.length > 0 && (
        <Section Icon={ClipboardList} cls="text-rose-600" ring="bg-rose-100 dark:bg-rose-950/40" title={doc.reserves.length > 1 ? `Réserves (${doc.reserves.length})` : 'Réserve'}>
          <ul className="space-y-1.5">
            {doc.reserves.map((r, i) => (
              <li key={i} className="text-[13px] leading-snug">
                <span className="font-medium">{r.label}</span>
                {r.location && <span className="text-muted-foreground"> — {r.location}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* 📋 Actions créées — si elles existent. */}
      {doc.actions.length > 0 && (
        <Section Icon={ListTodo} cls="text-violet-600" ring="bg-violet-100 dark:bg-violet-950/40" title={doc.actions.length > 1 ? `Actions créées (${doc.actions.length})` : 'Action créée'}>
          <ul className="space-y-1.5">
            {doc.actions.map((a, i) => (
              <li key={i} className="text-[13px] leading-snug">
                <span className="font-medium">{a.title}</span>
                {a.corps_etat && <span className="text-muted-foreground"> — {a.corps_etat}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* 📷 Médias — un aperçu (4 vignettes max), pas une galerie. */}
      {thumbs.length > 0 && (
        <Section Icon={Images} cls="text-amber-600" ring="bg-amber-100 dark:bg-amber-950/40" title="Médias">
          <div className="grid grid-cols-4 gap-2">
            {thumbs.map((url, i) => (
              <div key={i} className="relative aspect-square overflow-hidden rounded-lg border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="h-full w-full object-cover" />
              </div>
            ))}
            {mediaMore > 0 && (
              <div className="flex aspect-square items-center justify-center rounded-lg border bg-muted/40 text-sm font-semibold text-muted-foreground">
                +{mediaMore}
              </div>
            )}
          </div>
        </Section>
      )}

      {/* 📄 Documents générés — PDF + ordinateur. Télécharger reste secondaire. */}
      <Section Icon={FileText} cls="text-slate-600" ring="bg-slate-100 dark:bg-slate-800/60" title="Documents générés">
        <VisitOutputActions reportId={reportId} siteId={visit.site_id} showViewVisit={false} />
      </Section>

      {/* Le sens : le CR est désormais disponible partout — terrain → bureau. */}
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
        <p className="flex items-start gap-2 text-[13px] leading-relaxed text-emerald-900 dark:text-emerald-200">
          <Brain className="mt-0.5 h-[18px] w-[18px] shrink-0 text-emerald-600" />
          <span>Ce compte-rendu est maintenant disponible pour les prochaines visites, réunions et sur ordinateur.</span>
        </p>
      </div>
    </div>
  )
}

function Section({
  Icon, cls, ring, title, children,
}: {
  Icon: typeof FileText
  cls: string
  ring: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border bg-background p-3.5 shadow-sm">
      <div className="mb-2.5 flex items-center gap-2.5">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${ring}`}>
          <Icon className={`h-[18px] w-[18px] ${cls}`} />
        </span>
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  )
}
