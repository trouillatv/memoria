// N3.1 — LE RÉCIT DE VISITE, CÂBLÉ.
//
// « N1 : MemorIA écrit un compte-rendu. N2 : MemorIA explique ce qu'elle a
//   retenu. N3 : MemorIA démontre pourquoi chaque information existe. »
//
// L'écran est volontairement sobre — N3.2 en fera une salle d'enquête. Ce qui
// compte ici, c'est que tout soit FONCTIONNEL : chaque ligne dit pourquoi elle
// est là, chaque preuve peut être citée dans le compte-rendu, et ce qui n'a pas
// été retenu est montré au lieu d'être tu.

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, FileText } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getVisit } from '@/lib/db/visits'
import { buildVisitNarrative } from '@/lib/db/visit-narrative'
import { EvidenceCard } from '../EvidenceCard'

export const dynamic = 'force-dynamic'

const KIND_FR: Record<string, string> = {
  action: 'Action', reserve: 'Réserve', decision: 'Décision',
  echeance: 'Échéance', memoire: 'Mémoire', intervenant: 'Intervenant',
}

export default async function VisitNarrativePage({
  params,
}: {
  params: Promise<{ id: string; visitId: string }>
}) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id, visitId } = await params
  const [identity, visit, narrative] = await Promise.all([
    getSiteIdentity(id),
    getVisit(visitId),
    buildVisitNarrative(visitId),
  ])
  if (!identity || !visit || visit.site_id !== id || !narrative) notFound()
  // Isolation tenant : le service-role passe outre la RLS, le filtre est ICI.
  if (visit.organization_id && user.organization_id && visit.organization_id !== user.organization_id) {
    notFound()
  }

  const doc = narrative.validated.document
  const canPromote = doc?.status === 'draft'
  const dateVisite = (visit.created_at ?? '').slice(0, 10).split('-').reverse().join('/')

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-6">
      <header className="space-y-1">
        <Link
          href={`/sites/${id}/visites/${visitId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Retour à la visite
        </Link>
        <h1 className="text-xl font-semibold">Récit de la visite du {dateVisite}</h1>
        <p className="text-sm text-muted-foreground">
          {identity.name} — d’où vient chaque information, et ce qui n’a pas été retenu.
        </p>
      </header>

      {/* ── 1. CE QUI A ÉTÉ CAPTÉ ─────────────────────────────────────────── */}
      <Section
        title="Ce qui a été capté"
        count={narrative.captured.length}
        empty="Aucune capture : cette visite n’a laissé ni vocal, ni photo, ni note."
      >
        {narrative.captured.map((c) => (
          <EvidenceCard key={c.id} reportId={visitId} capture={c} canPromote={canPromote} />
        ))}
        {narrative.captured.length > 0 && !canPromote && (
          <p className="pt-2 text-xs text-muted-foreground">
            {doc
              ? 'Le compte-rendu est finalisé : rouvrez-le pour y citer une preuve.'
              : 'Aucun compte-rendu ouvert : générez-le pour pouvoir y citer une preuve.'}
          </p>
        )}
      </Section>

      {/* ── 2. CE QUE MEMORIA A COMPRIS ───────────────────────────────────── */}
      <Section
        title="Ce que MemorIA a compris"
        count={narrative.understood.length}
        empty="MemorIA n’a rien proposé pour cette visite."
      >
        {narrative.understood.map((p) => (
          <Line key={p.id} label={p.label} why={p.why.label} tag={p.type}>
            {p.rationale && <p className="text-[13px] text-muted-foreground">{p.rationale}</p>}
          </Line>
        ))}
      </Section>

      {/* ── 3. CE QUE L'HUMAIN A TRANCHÉ ──────────────────────────────────── */}
      <Section title="Ce que vous avez tranché" count={null} empty={null}>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          <Stat label="Confirmées" value={narrative.validated.confirmedProposals} />
          <Stat label="Écartées" value={narrative.validated.ignoredProposals} />
          <Stat label="En attente" value={narrative.validated.pendingProposals} />
          <Stat label="Sections corrigées" value={narrative.validated.correctedSections.length} />
          <Stat label="Captures écartées" value={narrative.validated.discardedCaptures} />
        </dl>
        {narrative.validated.supersededProposals > 0 && (
          <p className="pt-2 text-xs text-muted-foreground">
            {narrative.validated.supersededProposals} proposition
            {narrative.validated.supersededProposals > 1 ? 's sont devenues obsolètes' : ' est devenue obsolète'}{' '}
            après une nouvelle analyse — personne ne les a rejetées.
          </p>
        )}
        {doc && (
          <p className="pt-2 text-sm">
            <Link href={`/m/visite/${visitId}/cr`} className="inline-flex items-center gap-1 underline">
              <FileText className="h-3.5 w-3.5" aria-hidden />
              Ouvrir le compte-rendu ({doc.status === 'draft' ? 'brouillon' : 'finalisé'})
            </Link>
          </p>
        )}
      </Section>

      {/* ── 4. CE QUE LA VISITE A PRODUIT ─────────────────────────────────── */}
      <Section
        title="Ce que cette visite a produit"
        count={narrative.produced.length}
        empty="Aucun objet dont la création par cette visite soit démontrable."
      >
        {narrative.produced.map((p) => (
          <Line key={`${p.kind}:${p.id}`} label={p.label} why={p.why.label} tag={KIND_FR[p.kind] ?? p.kind}>
            {/* LE 4ᵉ MAILLON — et son absence est dite, jamais comblée. */}
            {p.evidence ? (
              <p className="text-[13px] text-muted-foreground">
                Preuve d’origine : {p.evidence.capture_kind} du{' '}
                {p.evidence.captured_at.slice(0, 10).split('-').reverse().join('/')} — «&nbsp;{p.evidence.text}&nbsp;»
              </p>
            ) : (
              <p className="text-[13px] text-muted-foreground">
                Née de l’analyse de l’ensemble de la visite : aucune preuve unique n’est démontrable.
              </p>
            )}
          </Line>
        ))}
        {narrative.limits.historicalAttributions > 0 && (
          <p className="pt-2 text-xs text-muted-foreground">
            {narrative.limits.historicalAttributions} objet
            {narrative.limits.historicalAttributions > 1 ? 's sont rattachés' : ' est rattaché'} à ce compte-rendu sans
            que sa création par cette visite soit démontrable — il n’est pas compté ici.
          </p>
        )}
      </Section>

      {/* ── CE QUE J'AI IGNORÉ — le contraire d'une IA qui veut avoir raison ── */}
      <Section
        title="Ce que MemorIA n’a pas retenu"
        count={
          narrative.ignored.byHuman.length + narrative.ignored.superseded.length + narrative.ignored.captures.length
        }
        empty="Rien n’a été écarté : tout ce qui a été capté ou proposé est encore en jeu."
      >
        {narrative.ignored.captures.map((c) => (
          <Line key={c.id} label={c.body?.trim() || `Capture ${c.kind}`} why={c.why.label} tag={c.kind} />
        ))}
        {narrative.ignored.byHuman.map((p) => (
          <Line key={p.id} label={p.label} why={p.why.label} tag={p.type} />
        ))}
        {narrative.ignored.superseded.map((p) => (
          <Line key={p.id} label={p.label} why={p.why.label} tag={p.type} />
        ))}
      </Section>

      <footer className="border-t pt-4 text-xs text-muted-foreground">
        Un intervenant n’a pas encore de lien prouvé avec la visite qui l’a fait connaître : ce chaînon manque, et il
        n’est pas simulé.
      </footer>
    </div>
  )
}

function Section({
  title,
  count,
  empty,
  children,
}: {
  title: string
  count: number | null
  /** L'état vide n'est pas un cas limite : sur les visites réelles, c'est la
   *  norme. Chaque couche a donc sa phrase. */
  empty: string | null
  children: React.ReactNode
}) {
  const isEmpty = count === 0
  return (
    <section className="space-y-1">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
        {count !== null && <span className="ml-2 font-normal normal-case tracking-normal">{count}</span>}
      </h2>
      {isEmpty && empty ? <p className="text-sm text-muted-foreground">{empty}</p> : children}
    </section>
  )
}

function Line({
  label,
  why,
  tag,
  children,
}: {
  label: string
  why: string
  tag?: string
  children?: React.ReactNode
}) {
  return (
    <div className="border-l py-2 pl-4">
      <p className="text-sm">
        {tag && (
          <span className="mr-2 rounded border px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            {tag}
          </span>
        )}
        {label}
      </p>
      {children}
      {/* « Pourquoi est-ce ici ? » — répondu partout, dérivé d'un fait. */}
      <p className="text-[11px] text-muted-foreground">{why}</p>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}
