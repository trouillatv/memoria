import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ShieldAlert, CheckCircle2, CircleSlash, Circle } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getSiteObligations, listObligationTemplates, type SiteObligation } from '@/lib/db/obligations'
import { DynamicCrumb, BreadcrumbPrefix } from '@/components/layout/BreadcrumbProvider'
import { ProposeObligations, ObligationStatusButtons } from './ObligationControls'

export const dynamic = 'force-dynamic'

const STATUS_LABEL: Record<string, string> = {
  a_produire: 'À produire', en_cours: 'En cours', satisfaite: 'Satisfaite', non_applicable: 'Non applicable',
}

function ObligationRow({ siteId, o }: { siteId: string; o: SiteObligation }) {
  const Icon = o.status === 'satisfaite' ? CheckCircle2 : o.status === 'non_applicable' ? CircleSlash : o.neglected ? ShieldAlert : Circle
  const tone = o.status === 'satisfaite' ? 'text-emerald-600' : o.status === 'non_applicable' ? 'text-muted-foreground' : o.neglected ? 'text-rose-600' : 'text-sky-600'
  return (
    <li className="rounded-lg border bg-card px-3 py-2.5 space-y-1.5">
      <div className="flex items-start gap-2">
        <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${tone}`} />
        <div className="min-w-0 flex-1">
          <span className="font-medium text-sm">{o.label}</span>
          <span className="block text-[11px] text-muted-foreground">
            {o.responsibleRole} · {STATUS_LABEL[o.status] ?? o.status}
            {o.neglected && o.healthReason && <span className="text-rose-600"> · ⚠ {o.healthReason}</span>}
          </span>
        </div>
      </div>
      <ObligationStatusButtons siteId={siteId} obligationId={o.id} status={o.status} />
    </li>
  )
}

export default async function SiteObligationsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  const [identity, obligations, templates] = await Promise.all([
    getSiteIdentity(id), getSiteObligations(id), listObligationTemplates(),
  ])
  if (!identity) notFound()

  // Bibliothèque encore proposable = modèles pas déjà instanciés sur ce chantier.
  const usedTemplateIds = new Set(obligations.map((o) => o.templateId).filter(Boolean) as string[])
  const choices = templates
    .filter((t) => !usedTemplateIds.has(t.id))
    .map((t) => ({ id: t.id, label: t.label, themes: t.themes, responsible: t.defaultResponsibleRole }))

  const neglected = obligations.filter((o) => o.neglected)
  const active = obligations.filter((o) => !o.neglected && o.status !== 'satisfaite' && o.status !== 'non_applicable')
  const done = obligations.filter((o) => o.status === 'satisfaite' || o.status === 'non_applicable')

  return (
    <div className="space-y-6 w-full max-w-2xl">
      <DynamicCrumb segmentId="obligations" label="Obligations" />
      <BreadcrumbPrefix crumbs={[{ href: '/sites', label: 'Sites' }, { href: `/sites/${id}`, label: identity.name }]} />

      <Link href={`/sites/${id}`} className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1">← {identity.name}</Link>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold inline-flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-muted-foreground" /> Obligations</h1>
        <p className="text-xs text-muted-foreground">
          Ce qui DOIT exister sur ce chantier (DOE, journal photo, essais…). MemorIA en surveille l&apos;absence et
          la rappelle avant la réunion. Une obligation, jamais une note d&apos;acteur.
        </p>
      </header>

      <ProposeObligations siteId={id} choices={choices} />

      {obligations.length === 0 ? (
        <p className="text-sm text-muted-foreground italic py-4 text-center">Aucune obligation sur ce chantier — proposez la bibliothèque standard ci-dessus.</p>
      ) : (
        <div className="space-y-6">
          {neglected.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-rose-700">À surveiller <span className="text-xs tabular-nums">({neglected.length})</span></h2>
              <ul className="space-y-1.5">{neglected.map((o) => <ObligationRow key={o.id} siteId={id} o={o} />)}</ul>
            </section>
          )}
          {active.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">En cours <span className="text-xs text-muted-foreground tabular-nums">({active.length})</span></h2>
              <ul className="space-y-1.5">{active.map((o) => <ObligationRow key={o.id} siteId={id} o={o} />)}</ul>
            </section>
          )}
          {done.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">Réglées <span className="text-xs tabular-nums">({done.length})</span></h2>
              <ul className="space-y-1.5">{done.map((o) => <ObligationRow key={o.id} siteId={id} o={o} />)}</ul>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
