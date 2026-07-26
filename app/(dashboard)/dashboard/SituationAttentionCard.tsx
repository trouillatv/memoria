'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Calendar, FileText, HelpCircle, ChevronDown } from 'lucide-react'
import type { AttentionCard } from '@/lib/situations/attention/types'
import { PromiseActions } from './PromiseActions'

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

export function SituationAttentionCard({ card }: { card: AttentionCard }) {
  const [expanded, setExpanded] = useState(false)
  const Icon = iconByName[card.icon]
  const palette = toneClasses[card.tone]

  const quickResolutions = card.resolutions.filter((r) => r.kind === 'fulfill_promise')
  const deepResolutions = card.resolutions.filter((r) => r.kind !== 'fulfill_promise')

  const hasExpandable =
    !!card.description
    || !!card.organizationLabel
    || !!card.primaryAction
    || card.secondaryActions.length > 0
    || (!!card.subject && deepResolutions.length > 0)

  return (
    <article className={`rounded-2xl border px-4 py-3 shadow-sm ${palette.shell}`}>
      <div className="flex items-start gap-3">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${palette.icon}`}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-snug text-[#17213a]">{card.title}</h3>
          <p className="mt-0.5 text-xs text-[#65718b]">
            {card.siteLabel}{card.timingLabel ? ` · ${card.timingLabel}` : ''}
          </p>

          {card.subject && quickResolutions.length > 0 && (
            <div className="mt-2">
              <PromiseActions subject={card.subject} resolutions={quickResolutions} />
            </div>
          )}

          {hasExpandable && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="mt-2 flex items-center gap-1 text-xs text-[#9aa7be] hover:text-[#5f6c84]"
            >
              <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
              {expanded ? 'Réduire' : "Plus d'actions"}
            </button>
          )}

          {expanded && (
            <div className="mt-3 space-y-2 border-t border-[#e5eaf3] pt-3">
              {card.description && (
                <p className="text-xs leading-relaxed text-[#5f6c84]">{card.description}</p>
              )}
              {card.organizationLabel && (
                <p className="text-xs text-[#65718b]">{card.organizationLabel}</p>
              )}
              {card.primaryAction && (
                <Link
                  href={card.primaryAction.href}
                  className="block text-xs text-[#4973dd] hover:underline"
                >
                  {card.primaryAction.label}
                </Link>
              )}
              {card.secondaryActions.map((action) => (
                <Link
                  key={`${card.id}:${action.kind}:${action.label}`}
                  href={action.href}
                  className="block text-xs text-[#4973dd] hover:underline"
                >
                  {action.label}
                </Link>
              ))}
              {card.subject && deepResolutions.length > 0 && (
                <PromiseActions subject={card.subject} resolutions={deepResolutions} />
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}
