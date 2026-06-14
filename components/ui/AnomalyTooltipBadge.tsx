'use client'

import { AlertTriangle } from 'lucide-react'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip'

export interface AnomalyDetail {
  label: string
  date: string
}

interface Props {
  count: number
  details: AnomalyDetail[]
  size?: 'xs' | 'sm'
  className?: string
}

export function AnomalyTooltipBadge({ count, details, size = 'xs', className }: Props) {
  const text = `${count} anomalie${count > 1 ? 's' : ''} ouverte${count > 1 ? 's' : ''}`
  const iconCls = size === 'sm' ? 'h-3.5 w-3.5' : 'h-3 w-3'
  const sizeCls = size === 'sm' ? 'text-xs' : 'text-[10px]'

  const inner = (
    <>
      <AlertTriangle className={`${iconCls} shrink-0`} aria-hidden />
      {text}
    </>
  )

  if (details.length === 0) {
    return (
      <span className={`inline-flex items-center gap-1 ${sizeCls} text-amber-700 dark:text-amber-300 ${className ?? ''}`}>
        {inner}
      </span>
    )
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={<span />}
          className={`inline-flex items-center gap-1 ${sizeCls} text-amber-700 dark:text-amber-300 cursor-default ${className ?? ''}`}
        >
          {inner}
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start">
          <ul className="space-y-1">
            {details.map((d, i) => (
              <li key={i} className="text-xs">
                <span className="font-medium">{d.label}</span>
                <span className="ml-1.5 opacity-70">— {d.date}</span>
              </li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
