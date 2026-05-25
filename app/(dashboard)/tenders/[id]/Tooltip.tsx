'use client'

import { useState, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'

interface TooltipProps {
  content: string
  delay?: number
  side?: 'right' | 'top' | 'bottom' | 'left'
  children: React.ReactNode
}

export function Tooltip({ content, delay = 150, side = 'right', children }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function clearTimer() {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }

  function onEnter() {
    clearTimer()
    timer.current = setTimeout(() => setVisible(true), delay)
  }

  function onLeave() {
    clearTimer()
    setVisible(false)
  }

  function onPress() {
    // Hide immediately on click so it doesn't linger over a popover/drawer
    clearTimer()
    setVisible(false)
  }

  useEffect(() => () => clearTimer(), [])

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onMouseDown={onPress}
      onFocus={onEnter}
      onBlur={onLeave}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          className={cn(
            'absolute z-30 px-2 py-1 text-[11px] leading-snug text-white bg-foreground/90 rounded shadow-lg pointer-events-none whitespace-pre-line',
            side === 'right'  && 'left-full top-1/2 -translate-y-1/2 ml-2',
            side === 'top'    && 'bottom-full left-1/2 -translate-x-1/2 mb-1',
            side === 'left'   && 'right-full top-1/2 -translate-y-1/2 mr-2',
            side === 'bottom' && 'top-full left-1/2 -translate-x-1/2 mt-1'
          )}
          style={{ maxWidth: 360 }}
        >
          {content}
        </span>
      )}
    </span>
  )
}
