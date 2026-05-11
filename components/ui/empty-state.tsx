import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  /** String ou JSX (pour liens inline dans la description). */
  description?: ReactNode
  /** CTA principal — par ex. `<Link><Button>…</Button></Link>`. */
  primaryAction?: ReactNode
  /** CTA secondaire (lien vers doc, action alternative…). */
  secondaryAction?: ReactNode
  className?: string
  /** `compact` réduit le padding + taille — utiliser sur mobile / cartes étroites. */
  variant?: 'default' | 'compact'
}

/**
 * Empty state réutilisable : icône lucide-react sobre dans un cercle muted,
 * titre, description et CTA optionnels. Doctrine UX : calme, rassurant,
 * direction claire. Pas de blabla marketing.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  className,
  variant = 'default',
}: EmptyStateProps) {
  const isCompact = variant === 'compact'
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        isCompact ? 'py-12 px-4' : 'py-20 px-6',
        className,
      )}
      data-slot="empty-state"
    >
      {Icon && (
        <div
          className={cn(
            'flex items-center justify-center rounded-full bg-muted/50 text-muted-foreground mb-4',
            isCompact ? 'h-12 w-12' : 'h-16 w-16',
          )}
          aria-hidden="true"
        >
          <Icon className={isCompact ? 'h-5 w-5' : 'h-7 w-7'} strokeWidth={1.5} />
        </div>
      )}
      <h3
        className={cn(
          'font-semibold text-foreground mb-2',
          isCompact ? 'text-base' : 'text-lg',
        )}
      >
        {title}
      </h3>
      {description && (
        <p
          className={cn(
            'text-muted-foreground max-w-md mb-6',
            isCompact ? 'text-xs' : 'text-sm',
          )}
        >
          {description}
        </p>
      )}
      {(primaryAction || secondaryAction) && (
        <div className="flex flex-col sm:flex-row gap-2 items-center">
          {primaryAction}
          {secondaryAction}
        </div>
      )}
    </div>
  )
}
