import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowLeft, Eye, ClipboardList, ListTodo, Gavel, Camera, FileText,
  ChevronRight, Star, Monitor, Check, MapPin, Download, CheckCircle2, ArrowRight, Home, Pencil,
} from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { createAdminClient } from '@/lib/supabase/admin'
import { getVisit, buildVisitCrDoc } from '@/lib/db/visits'
import { listDecisionsByReport } from '@/lib/db/site-decisions'
import { CaptureMap } from '@/components/CaptureMap'
import { CrMapSnapshotTrigger } from './CrMapSnapshotTrigger'
import { MemoriaRetained } from './MemoriaRetained'
import { VisitShareButton } from '../VisitShareButton'

export const dynamic = 'force-dynamic'

/**
 * « Aperçu du compte-rendu » — PAS un PDF affiché dans le téléphone, PAS un lecteur
 * de document. Une lecture RAPIDE (< 20 s) pour vérifier, avant de quitter le site,
 * que le chantier est correctement documenté : « si quelqu'un ouvre ce dossier
 * demain matin, qu'est-ce qu'il va lire ? ». Le PDF complet reste à un clic.
 * Règle : jamais une section vide — la page se recompose autour du réel.
 */

export default async function VisitCrPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ reportId: string }>
  searchParams: Promise<{ done?: string }>
}) {
  const { reportId } = await params
  // `?done=1` : on vient de terminer la visite → le CR sert AUSSI d'écran de
  // clôture (confirmation + actions de sortie). Sinon, c'est une consultation.
  const done = (await searchParams).done === '1'
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

  // ── LE PDF CHANGE QUAND LA SYNTHÈSE CHANGE — ET SON NOM AUSSI ──────────────
  // Le nom du fichier était unique par VISITE (chantier + date + heure), jamais
  // par VERSION du contenu. Or la synthèse évolue : on met à jour, on confirme, le
  // gabarit change — et le PDF n'est plus le même. Même nom, contenu différent.
  //
  // Résultat, constaté par Vincent : « Télécharger » demande de remplacer le
  // fichier (donc on obtient bien le neuf), mais « Voir le PDF » rouvre l'ANCIEN —
  // celui déjà présent dans Téléchargements. Le conducteur croit que MemorIA lui
  // ment, alors qu'elle a bien travaillé : c'est le téléphone qui rouvre un
  // fichier qu'il croit être le même, parce qu'il porte le même nom.
  //
  // La signature de version suit ce qui fait VRAIMENT changer le PDF : la synthèse
  // (son numéro + le moment où elle a été écrite). Elle voyage dans l'URL — le
  // navigateur voit une adresse neuve, pas une relecture — et dans le nom du
  // fichier, pour que le téléphone ne confonde plus deux versions.
  const analysis = (visit.debrief_analysis ?? null) as { analysis_version?: number; generated_at?: string } | null
  const pdfVersion = analysis?.generated_at
    ? `v${analysis.analysis_version ?? 1}-${Date.parse(analysis.generated_at) || 0}`
    : `v0-${Date.parse(visit.updated_at ?? '') || 0}`
  const pdfHref = `/m/visite/${reportId}/pdf?v=${encodeURIComponent(pdfVersion)}`
  // ?download=1 → attachment (le téléphone enregistre le fichier).
  const pdfDownloadHref = `${pdfHref}&download=1`
  const isAo = doc.motive === 'previsite_ao'
  const isPremiere = visit.visit_motive === 'premiere'

  // Prochaine étape après clôture : pour une VRAIE prévisite AO (dossier en phase
  // prospect/en_ao) la suite se joue sur ordinateur → « Retour au dossier AO ».
  // Sinon, retour au chantier. Même règle que l'ancien écran de fin.
  let previsiteDossierId: string | null = null
  if (visit.dossier_id) {
    const supabase = createAdminClient()
    const { data: dossier } = await supabase
      .from('dossiers').select('phase').eq('id', visit.dossier_id).maybeSingle()
    const phase = (dossier as { phase: string } | null)?.phase
    if (phase === 'prospect' || phase === 'en_ao') previsiteDossierId = visit.dossier_id
  }
  const finishedTitle = isAo
    ? 'Prévisite enregistrée'
    : isPremiere
    ? 'Première visite enregistrée'
    : 'Visite enregistrée'

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
      {done ? (
        // Clôture réunie à la récompense : une confirmation chaleureuse mais
        // discrète, juste au-dessus du compte-rendu qu'on vient d'obtenir.
        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3.5 py-3 dark:border-emerald-900/40 dark:bg-emerald-950/20">
          <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">{finishedTitle}</p>
            <p className="text-[12px] text-emerald-800/80 dark:text-emerald-300/80">Voici votre compte-rendu.</p>
          </div>
        </div>
      ) : (
        <Link
          href={`/m/visite/${reportId}/recap`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Récap
        </Link>
      )}

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

      {/* « Ce que MemorIA a retenu » — le RÉSULTAT en premier (résumé, actions
          proposées, points de vigilance), analysé automatiquement à l'ouverture
          (lazy-once + cache). La transcription brute est repliée dedans. */}
      <MemoriaRetained reportId={reportId} siteId={visit.site_id} transcriptions={doc.transcriptions} />

      {/* Les observations brutes (constats, incl. transcriptions vocales) NE sont plus
          affichées ici : « Ce que MemorIA a retenu » ci-dessus EST la lecture. Le
          verbatim reste accessible replié dans la synthèse et dans le CR complet. */}

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
                <a href={pdfHref} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex items-center gap-0.5 text-[12px] font-medium text-violet-700">
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
        {/* DEUX gestes honnêtes (limite plateforme PWA assumée) :
            - « Voir le PDF » = aperçu rapide (inline). En PWA installée, le rendu
              peut être limité — on NE promet PAS l'enregistrement local depuis là.
            - « Télécharger » = le vrai fichier (Content-Disposition: attachment,
              nom propre) : Android le range dans Téléchargements, puis ouvrir /
              partager / imprimer / déplacer. C'est l'action fiable pour récupérer. */}
        <div className="mt-2 grid grid-cols-2 gap-2">
          <a
            href={pdfHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 rounded-xl border px-4 py-2.5 text-sm font-medium active:bg-accent"
          >
            <Eye className="h-4 w-4" /> Voir le PDF
          </a>
          <a
            href={pdfDownloadHref}
            download
            className="flex items-center justify-center gap-1.5 rounded-xl bg-foreground px-4 py-2.5 text-sm font-semibold text-background active:brightness-95"
          >
            <Download className="h-4 w-4" /> Télécharger
          </a>
        </div>
        <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground">
          Pour enregistrer le fichier sur votre téléphone, utilisez{' '}
          <strong className="font-medium text-foreground">Télécharger</strong>. L’aperçu sert seulement à vérifier le compte-rendu.
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

      {/* Actions de sortie — la suite du parcours, réunie sous la récompense.
          Le PDF a sa place canonique (section « Documents générés ») ; ici on
          navigue : repartir, revoir/corriger ses captures, ou partager. */}
      <div className="space-y-2 pt-1">
        {previsiteDossierId ? (
          <Link
            href={`/dossiers/${previsiteDossierId}`}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-foreground px-4 py-3.5 text-sm font-semibold text-background"
          >
            Retour au dossier AO <ArrowRight className="h-4 w-4" />
          </Link>
        ) : (
          <Link
            href={`/m/site/${visit.site_id}${done ? '?visite=ok' : ''}`}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-foreground px-4 py-3.5 text-sm font-semibold text-background"
          >
            <Home className="h-4 w-4" /> Retour au chantier
          </Link>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Link
            href={`/m/visite/${reportId}`}
            className="flex items-center justify-center gap-1.5 rounded-xl border px-4 py-2.5 text-sm font-medium active:bg-accent"
          >
            <Pencil className="h-4 w-4" /> Modifier les captures
          </Link>
          <VisitShareButton reportId={reportId} siteName={doc.siteName} />
        </div>
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
