import Link from 'next/link'
import { AlertTriangle, CheckCircle2, ChevronRight, Eye, Lock } from 'lucide-react'
import type { AttentionDigest, AttentionItem } from '@/lib/db/attention'
import { OrgBadge, orgLabelOf, type OrgLabels } from '@/components/dashboard/OrgBadge'

function Row({ it, orgLabels, urgent }: { it: AttentionItem; orgLabels: OrgLabels; urgent: boolean }) {
  const badge = orgLabelOf(orgLabels, it.organizationId)

  return (
    <Link
      href={it.href}
      className="group flex items-start gap-4 rounded-2xl border border-slate-100 bg-slate-50/70 px-4 py-4 transition-all hover:-translate-y-0.5 hover:border-slate-200 hover:bg-white hover:shadow-sm"
    >
      <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${urgent ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-600'}`}>
        {urgent ? <AlertTriangle className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-sm font-semibold text-slate-900">
          {badge && <><OrgBadge label={badge} /> </>}
          {it.what} <span className="font-normal text-slate-500">— {it.where}</span>
        </span>
        <span className="mt-1 block text-xs leading-relaxed text-slate-500">{it.why}</span>
      </span>
      <ChevronRight className="mt-3 h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-500" />
    </Link>
  )
}

export function AttentionBlock({ digest, orgLabels = null }: { digest: AttentionDigest; orgLabels?: OrgLabels }) {
  const { red, orange, greenSites, totalSites, closedToday = [] } = digest
  if (totalSites === 0) return null
  const nothing = red.length === 0 && orange.length === 0

  return (
    <section className="space-y-5 rounded-3xl border border-rose-100 bg-white p-5 shadow-[0_12px_40px_rgba(15,23,42,0.05)] sm:p-7">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-500">Aujourd&apos;hui</p>
          <h2 className="mt-1 text-xl font-semibold tracking-[-0.02em] text-slate-950">Ce qui mérite votre attention</h2>
        </div>
        <span className="hidden rounded-full bg-rose-50 px-3 py-1 text-xs font-medium text-rose-600 sm:inline-flex">À traiter en priorité</span>
      </div>

      {closedToday.length > 0 && (
        <p className="inline-flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          <span>
            Fermé{closedToday.length > 1 ? 's' : ''} aujourd&apos;hui :{' '}
            {closedToday.map((c, i) => (
              <span key={c.siteId}>
                {i > 0 && ', '}
                <Link href={`/sites/${c.siteId}`} className="font-medium hover:underline">{c.siteName}</Link>{' '}
                <span className="opacity-80">({c.reason.toLowerCase()})</span>
              </span>
            ))}
          </span>
        </p>
      )}

      {nothing ? (
        <p className="inline-flex items-center gap-2 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" /> En rythme — {totalSites} chantier{totalSites > 1 ? 's' : ''}, rien à signaler aujourd&apos;hui.
        </p>
      ) : (
        <div className="space-y-5">
          {red.length > 0 && (
            <div className="space-y-2">
              <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-rose-600">
                <AlertTriangle className="h-3.5 w-3.5" /> À traiter
              </p>
              <ul className="space-y-2">{red.map((it, i) => <li key={i}><Row it={it} urgent orgLabels={orgLabels} /></li>)}</ul>
            </div>
          )}
          {orange.length > 0 && (
            <div className="space-y-2">
              <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-amber-600">
                <Eye className="h-3.5 w-3.5" /> À surveiller
              </p>
              <ul className="space-y-2">{orange.map((it, i) => <li key={i}><Row it={it} urgent={false} orgLabels={orgLabels} /></li>)}</ul>
            </div>
          )}
          {greenSites > 0 && (
            <p className="inline-flex items-center gap-1.5 text-sm text-emerald-700/80">
              <CheckCircle2 className="h-4 w-4" /> {greenSites} chantier{greenSites > 1 ? 's' : ''} en rythme.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
