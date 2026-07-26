import Link from 'next/link'
import { AlertTriangle, Calendar, FileText, HelpCircle, ChevronRight } from 'lucide-react'
import type { AttentionCard } from '@/lib/situations/attention/types'
import { AttentionCardResolutions } from './PromiseActions'

const iconByName = {
  calendar: Calendar,
  question: HelpCircle,
  document: FileText,
  warning: AlertTriangle,
} as const

const toneClasses = {
  neutral: {
    shell: 'border-[#e5eaf3] bg-white',
    icon: 'bg-[#eef4ff] text-[#4973dd]',
  },
  amber: {
    shell: 'border-[#f2e2b7] bg-[#fffaf0]',
    icon: 'bg-[#fff0d7] text-[#e39a35]',
  },
  red: {
    shell: 'border-[#f2c9cc] bg-[#fff7f8]',
    icon: 'bg-[#ffe3e5] text-[#e35c66]',
  },
} as const

function ActionLink({ label, href, primary }: { label: string; href: string; primary?: boolean }) {
  const className = primary
    ? 'inline-flex items-center justify-center rounded-xl bg-[#1463e8] px-3 py-2 text-xs font-semibold text-white hover:bg-[#0c4dbd]'
    : 'inline-flex items-center justify-center rounded-xl border border-[#dbe2ef] bg-white px-3 py-2 text-xs font-semibold text-[#33415c] hover:bg-[#f7f9fd]'

  return <Link href={href} className={className}>{label}</Link>
}

export function SituationAttentionCard({ card }: { card: AttentionCard }) {
  const Icon = iconByName[card.icon]
  const palette = toneClasses[card.tone]

  return (
    <article className={`rounded-2xl border px-4 py-4 shadow-sm ${palette.shell}`}>
      <div className="flex items-start gap-4">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${palette.icon}`}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-[#17213a]">{card.title}</h3>
              {card.description && <p className="mt-1 text-xs leading-relaxed text-[#5f6c84]">{card.description}</p>}
            </div>
            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-[#9aa7be]" />
          </div>

          <div className="mt-3 space-y-1 text-xs text-[#65718b]">
            <p className="font-medium text-[#34415c]">{card.siteLabel}</p>
            {card.organizationLabel && <p>{card.organizationLabel}</p>}
            {card.timingLabel && <p>{card.timingLabel}</p>}
            {card.sourceLabel && <p>{card.sourceLabel}</p>}
          </div>

          {(card.primaryAction || card.secondaryActions.length > 0) && (
            <div className="mt-4 flex flex-wrap gap-2">
              {card.primaryAction && <ActionLink label={card.primaryAction.label} href={card.primaryAction.href} primary />}
              {card.secondaryActions.map((action) => (
                <ActionLink key={`${card.id}:${action.kind}:${action.label}`} label={action.label} href={action.href} />
              ))}
            </div>
          )}

          {/* Gestes de RÉSOLUTION (T4) — mutations avec confirmation inline. */}
          <AttentionCardResolutions card={card} />
        </div>
      </div>
    </article>
  )
}
