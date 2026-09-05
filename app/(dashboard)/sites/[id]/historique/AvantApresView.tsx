import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { SiteWindowComparison, WindowBoundState, WindowChangeCategory, WindowSubjectDelta } from '@/lib/documents/pv-window-comparison'
import { WindowBoundsSelector } from './WindowBoundsSelector'

// AVANT / APRÈS — « montre-moi uniquement ce qui a réellement changé entre ces deux moments ».
// Restitution SANS jargon interne. Trois registres seulement sont ouverts d'emblée : ce qui est
// réellement interprétable comme un changement métier. Les catégories volumineuses ou ambiguës
// (plus mentionnés, état précisé, inchangés) restent accessibles, repliées.

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
}

const STATE_LABEL: Record<WindowBoundState, string> = {
  absent: 'pas encore suivi',
  unknown: 'état non précisé',
  open: 'ouvert',
  resolved: 'résolu',
}

interface Register {
  key: WindowChangeCategory
  title: string
  hint: string
  accent: string
  icon: string
}

/** Registres OUVERTS : vrais changements métier entre les deux bornes. */
const VISIBLE_REGISTERS: Register[] = [
  { key: 'réouvert', title: 'Réouverts', hint: 'résolus à la première date, de nouveau ouverts à la seconde', accent: 'text-orange-600 dark:text-orange-400', icon: '↩' },
  { key: 'résolu', title: 'Résolus', hint: 'ouverts à la première date, résolus à la seconde', accent: 'text-emerald-600 dark:text-emerald-400', icon: '✓' },
  { key: 'apparu', title: 'Apparus', hint: 'absents de tout l’historique avant la première date', accent: 'text-blue-600 dark:text-blue-400', icon: '+' },
  { key: 'réapparu', title: 'Réapparus', hint: 'connus auparavant, absents à la première date, de retour à la seconde', accent: 'text-purple-600 dark:text-purple-400', icon: '↗' },
]

/** Registres REPLIÉS : ni changement métier, ni interprétables tels quels. */
const FOLDED_REGISTERS: Register[] = [
  { key: 'plus_mentionné', title: 'Plus mentionnés', hint: 'absents du compte rendu d’arrivée — leur dernier état connu est conservé, ce n’est pas une résolution', accent: 'text-muted-foreground', icon: '○' },
  { key: 'état_précisé', title: 'État précisé', hint: 'leur état n’était pas établi à la première date, il l’est à la seconde — ce n’est pas un changement de situation', accent: 'text-muted-foreground', icon: '?' },
  { key: 'inchangé', title: 'Inchangés', hint: 'même état aux deux dates', accent: 'text-muted-foreground', icon: '=' },
]

function SubjectRow({ item, siteId }: { item: WindowSubjectDelta; siteId: string }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1.5">
      <Link
        href={`/sites/${siteId}/historique/sujets/${item.canonicalSubjectId}`}
        className="min-w-0 flex-1 truncate text-sm underline-offset-2 hover:underline"
      >
        {item.label}
      </Link>
      <span className="shrink-0 text-xs text-muted-foreground">
        {STATE_LABEL[item.beforeState]} → {STATE_LABEL[item.afterState]}
        {item.stateEventCount > 1 && ` · ${item.stateEventCount} constats entre les deux dates`}
      </span>
    </li>
  )
}

function RegisterBlock({ reg, items, siteId }: { reg: Register; items: WindowSubjectDelta[]; siteId: string }) {
  return (
    <section className="rounded-[18px] border bg-card p-4 shadow-sm">
      <div className="flex items-baseline gap-2">
        <span className={cn('w-4 shrink-0 text-center font-bold', reg.accent)} aria-hidden>{reg.icon}</span>
        <h3 className="text-sm font-semibold">
          <span className={reg.accent}>{items.length}</span> · {reg.title}
        </h3>
      </div>
      <p className="ml-6 mt-0.5 text-xs text-muted-foreground">{reg.hint}</p>
      {items.length > 0 && (
        <ul className="ml-6 mt-2 divide-y divide-border">
          {items.map((it) => <SubjectRow key={it.canonicalSubjectId} item={it} siteId={siteId} />)}
        </ul>
      )}
    </section>
  )
}

export function AvantApresView({ siteId, data }: { siteId: string; data: SiteWindowComparison }) {
  const byCat = (k: WindowChangeCategory) => data.rows.filter((r) => r.category === k)
  const netChanges = VISIBLE_REGISTERS.reduce((s, r) => s + data.counts[r.key], 0)

  return (
    <div className="space-y-3">
      <section className="rounded-[22px] border bg-card p-5 shadow-sm">
        <WindowBoundsSelector
          siteId={siteId}
          runs={data.runs.map((r) => ({ runId: r.id, effectiveDate: r.effectiveDate, pvNumber: r.pvNumber }))}
          fromRunId={data.from.runId}
          toRunId={data.to.runId}
        />
        <p className="mt-4 text-sm">
          Entre le <span className="font-medium">{fmt(data.from.effectiveDate)}</span> et le{' '}
          <span className="font-medium">{fmt(data.to.effectiveDate)}</span>,{' '}
          {netChanges === 0 ? (
            <span className="font-medium">aucun changement de situation</span>
          ) : (
            <><span className="font-medium">{netChanges} sujet{netChanges > 1 ? 's ont' : ' a'} réellement changé</span></>
          )}{' '}
          <span className="text-muted-foreground">sur {data.rows.length} suivis à cette période.</span>
        </p>
      </section>

      {VISIBLE_REGISTERS.map((reg) => (
        <RegisterBlock key={reg.key} reg={reg} items={byCat(reg.key)} siteId={siteId} />
      ))}

      {FOLDED_REGISTERS.map((reg) => {
        const items = byCat(reg.key)
        return (
          <details key={reg.key} className="rounded-[18px] border bg-card shadow-sm">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm">
              <span className="font-semibold">{items.length} · {reg.title}</span>
              <span className="ml-2 text-xs text-muted-foreground">{reg.hint}</span>
            </summary>
            {items.length > 0 && (
              <ul className="divide-y divide-border px-4 pb-3">
                {items.map((it) => <SubjectRow key={it.canonicalSubjectId} item={it} siteId={siteId} />)}
              </ul>
            )}
          </details>
        )
      })}
    </div>
  )
}
