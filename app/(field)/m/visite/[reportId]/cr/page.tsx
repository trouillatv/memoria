import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowLeft, ListChecks, Eye, ClipboardList, ListTodo, Gavel, Camera, FileText,
  ChevronRight, Star, Monitor, Check, MapPin, Download,
} from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getVisit, buildVisitCrDoc, type VisitCrDoc } from '@/lib/db/visits'
import { listDecisionsByReport } from '@/lib/db/site-decisions'
import { CaptureMap } from '@/components/CaptureMap'
import { CrMapSnapshotTrigger } from './CrMapSnapshotTrigger'

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

  const [doc, decisions] = await Promise.all([
    buildVisitCrDoc(reportId, user.id),
    listDecisionsByReport(reportId).catch(() => []),
  ])
  if (!doc) notFound()

  const pdfHref = `/m/visite/${reportId}/pdf`
  // ?download=1 → attachment (le téléphone enregistre le fichier).
  const pdfDownloadHref = `${pdfHref}?download=1`
  const isAo = doc.motive === 'previsite_ao'
  const summary = doc.summary?.trim() || fallbackSummary(doc)

  // Observations = les constats retenus, plafonnés (le reste est dans le CR complet).
  const OBS_MAX = 5
  const observations = doc.constats.slice(0, OBS_MAX)
  const obsMore = doc.constats.length - observations.length

  const hasReserves = doc.reserves.length > 0
  const hasActions = doc.actions.length > 0
  const twoCol = hasReserves && hasActions

  const decisionTitres = decisions.map((d) => d.titre).filter(Boolean).slice(0, 4)
  const decMore = decisions.length - decisionTitres.length

  // Photos clés = un aperçu (3 vignettes), pas une galerie. « +N » si davantage.
  const thumbs = doc.photoCount > 3 ? doc.photos.slice(0, 2) : doc.photos.slice(0, 3)
  const photosMore = doc.photoCount - thumbs.length

  // Carte des observations : les captures géolocalisées, sur le plan interactif.
  const mapCaptures = doc.positions.map((p) => ({
    id: p.id, kind: p.kind, lat: p.lat, lng: p.lng,
    created_at: p.capturedAt, body: p.body, reportId, subjectName: null,
  }))

  return (
    <div className="mx-auto min-h-dvh max-w-md space-y-3.5 px-4 pb-16 pt-5">
      <Link
        href={`/m/visite/${reportId}/recap`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Récap
      </Link>

      <header className="space-y-0.5">
        <h1 className="text-xl font-semibold">Compte-rendu de visite</h1>
        <p className="text-sm text-muted-foreground first-letter:uppercase">{doc.siteName} · {doc.dateLabel}</p>
      </header>

      {/* Contexte : d'où vient ce document. */}
      <div className="flex items-start gap-2.5 rounded-xl border bg-sky-50/50 p-3 dark:bg-sky-950/20">
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
        <p className="text-[13px] leading-snug text-muted-foreground">
          Ce compte-rendu a été assemblé à partir des éléments capturés sur le terrain.
        </p>
      </div>

      {/* Résumé — 3 à 6 lignes, puis le CR complet à un clic. */}
      <Section Icon={ListChecks} cls="text-emerald-600" ring="bg-emerald-100 dark:bg-emerald-950/40" title="Résumé">
        <p className="line-clamp-6 whitespace-pre-line text-[13px] leading-relaxed text-foreground/90">{summary}</p>
      </Section>

      {/* Observations principales — seulement les constats importants. */}
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

      {/* Réserves + Actions — côte à côte quand les deux existent. */}
      {(hasReserves || hasActions) && (
        <div className={twoCol ? 'grid grid-cols-2 gap-3' : ''}>
          {hasReserves && (
            <Section Icon={ClipboardList} cls="text-rose-600" ring="bg-rose-100 dark:bg-rose-950/40" title="Réserves" badge={doc.reserves.length} compact={twoCol}>
              <ul className="space-y-1.5">
                {doc.reserves.slice(0, 2).map((r, i) => (
                  <li key={i} className="text-[13px] leading-snug">
                    <span className="font-medium">{r.label}</span>
                    {r.location && <span className="text-muted-foreground"> — {r.location}</span>}
                  </li>
                ))}
              </ul>
              {doc.reserves.length > 2 && (
                <p className="mt-1.5 text-[12px] text-muted-foreground">+{doc.reserves.length - 2} autre{doc.reserves.length - 2 > 1 ? 's' : ''}</p>
              )}
            </Section>
          )}
          {hasActions && (
            <Section Icon={ListTodo} cls="text-violet-600" ring="bg-violet-100 dark:bg-violet-950/40" title="Actions créées" badge={doc.actions.length} compact={twoCol}>
              <ul className="space-y-1.5">
                {doc.actions.slice(0, 2).map((a, i) => (
                  <li key={i} className="text-[13px] leading-snug">
                    <span className="font-medium">{a.title}</span>
                    {a.corps_etat && <span className="text-muted-foreground"> — {a.corps_etat}</span>}
                  </li>
                ))}
              </ul>
              {doc.actions.length > 2 && (
                <a href={pdfDownloadHref} className="mt-1.5 inline-flex items-center gap-0.5 text-[12px] font-medium text-violet-700">
                  Voir toutes les actions <ChevronRight className="h-3.5 w-3.5" />
                </a>
              )}
            </Section>
          )}
        </div>
      )}

      {/* Décisions prises — si elles existent (réelles : site_decisions liées au CR). */}
      {decisionTitres.length > 0 && (
        <Section Icon={Gavel} cls="text-indigo-600" ring="bg-indigo-100 dark:bg-indigo-950/40" title="Décisions prises">
          <ul className="space-y-1.5">
            {decisionTitres.map((t, i) => (
              <li key={i} className="flex gap-2 text-[13px] leading-snug text-foreground/90">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-indigo-500" />
                <span className="min-w-0">{t}</span>
              </li>
            ))}
          </ul>
          {decMore > 0 && (
            <p className="mt-1.5 text-[12px] text-muted-foreground">+{decMore} autre{decMore > 1 ? 's' : ''}</p>
          )}
        </Section>
      )}

      {/* Localisation des observations — le « où », entre les constats et les
          preuves. La carte fait le lien entre ce qui a été constaté et les photos.
          Si aucune capture n'est géolocalisée : un encart pédagogique, pas du vide. */}
      <Section Icon={MapPin} cls="text-sky-600" ring="bg-sky-100 dark:bg-sky-950/40" title="Localisation des observations">
        {mapCaptures.length > 0 ? (
          <div className="overflow-hidden rounded-xl border">
            <CaptureMap siteId={visit.site_id} captures={mapCaptures} heightClass="h-60" />
            {/* Produit en fond l'instantané carte que le PDF réutilisera. */}
            <CrMapSnapshotTrigger reportId={reportId} />
          </div>
        ) : (
          <div className="rounded-xl border border-dashed bg-muted/30 px-4 py-6 text-center">
            <MapPin className="mx-auto h-6 w-6 text-muted-foreground/40" />
            <p className="mt-2 text-sm font-medium">Aucune observation géolocalisée</p>
            <p className="mx-auto mt-1 max-w-xs text-[13px] leading-relaxed text-muted-foreground">
              Activez la localisation des observations lors d’une prochaine visite pour retrouver automatiquement les photos, notes et vocaux sur le plan.
            </p>
          </div>
        )}
      </Section>

      {/* Photos clés — aperçu visuel (3 vignettes), pas une galerie. */}
      {thumbs.length > 0 && (
        <Section Icon={Camera} cls="text-emerald-600" ring="bg-emerald-100 dark:bg-emerald-950/40" title="Photos clés">
          <div className="grid grid-cols-3 gap-2">
            {thumbs.map((url, i) => (
              <div key={i} className="relative aspect-square overflow-hidden rounded-lg border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="h-full w-full object-cover" />
              </div>
            ))}
            {photosMore > 0 && (
              <div className="flex aspect-square items-center justify-center rounded-lg border bg-muted/40 text-sm font-semibold text-muted-foreground">
                +{photosMore}
              </div>
            )}
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground">{doc.photoCount} photo{doc.photoCount > 1 ? 's' : ''} au total</p>
        </Section>
      )}

      {/* Documents générés — LE seul endroit pour le PDF : l'ouvrir OU le
          télécharger. Une seule section, deux gestes clairs. */}
      <Section Icon={FileText} cls="text-slate-600" ring="bg-slate-100 dark:bg-slate-800/60" title="Documents générés">
        <div className="flex items-center gap-3 rounded-xl border bg-background p-3">
          <FileText className="h-5 w-5 shrink-0 text-rose-600" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">Compte-rendu de visite</span>
            <span className="block text-[12px] text-muted-foreground">PDF</span>
          </span>
        </div>
        {/* PWA : une fenêtre in-app ne sait pas RENDRE un PDF (écran noir). Le
            seul chemin fiable = TÉLÉCHARGER le fichier — Android le prend alors
            en charge et l'ouvre dans SON lecteur PDF natif (partager / imprimer /
            enregistrer). Disposition 'attachment' + pas de target : pas de fenêtre
            vide, un téléchargement en place, puis le lecteur d'Android. */}
        <a
          href={pdfDownloadHref}
          className="mt-2 flex items-center justify-center gap-1.5 rounded-xl bg-foreground px-4 py-3 text-sm font-semibold text-background active:brightness-95"
        >
          <Download className="h-4 w-4" /> Ouvrir le PDF
        </a>
        <p className="mt-1.5 text-center text-[12px] text-muted-foreground">
          S’ouvre dans le lecteur PDF de votre téléphone — vous pouvez l’enregistrer, le partager ou l’imprimer.
        </p>
      </Section>

      {/* Le sens : ce que devient ce CR — le lien terrain → patrimoine numérique. */}
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
        <p className="flex items-center gap-2 text-sm font-semibold text-emerald-900 dark:text-emerald-200">
          <Star className="h-[18px] w-[18px] shrink-0 fill-amber-400 text-amber-400" />
          Ce compte-rendu est
        </p>
        <ul className="mt-2.5 space-y-1.5">
          <CheckLine text="intégré à l’historique du chantier" />
          <CheckLine text="disponible pour les prochaines visites" />
          <CheckLine text="disponible pour les prochaines réunions" />
          <CheckLine text="téléchargeable sur ordinateur" />
        </ul>
        {isAo && (
          <div className="mt-2.5 flex items-start gap-2 border-t border-emerald-200/70 pt-2.5 text-[13px] text-emerald-900/90 dark:border-emerald-900/40 dark:text-emerald-200/90">
            <Monitor className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            <span><strong className="font-medium">Prévisite AO</strong> — disponible depuis l’ordinateur pour préparer la réponse à l’appel d’offres.</span>
          </div>
        )}
      </div>
    </div>
  )
}

function Section({
  Icon, cls, ring, title, badge, compact, children,
}: {
  Icon: typeof FileText
  cls: string
  ring: string
  title: string
  badge?: number
  compact?: boolean
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border bg-background p-3.5 shadow-sm">
      <div className="mb-2.5 flex items-center gap-2.5">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${ring}`}>
          <Icon className={`h-[18px] w-[18px] ${cls}`} />
        </span>
        <h2 className={`min-w-0 flex-1 font-semibold ${compact ? 'truncate text-[13px]' : 'text-sm'}`}>{title}</h2>
        {badge != null && (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">{badge}</span>
        )}
      </div>
      {children}
    </section>
  )
}

function CheckLine({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2 text-[13px] text-emerald-900/90 dark:text-emerald-200/90">
      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
      <span className="min-w-0">{text}</span>
    </li>
  )
}
