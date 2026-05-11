import { cn } from '@/lib/utils'

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string
}

/**
 * Skeleton primitive — animate-pulse + bg-muted/60.
 *
 * Doctrine : sobre, calme, mime la structure de l'élément qu'il remplace.
 * Pas de spinner central, pas de shimmer fancy. Le caller passe height/width
 * via `className` (ex. `h-7 w-64`).
 */
export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      data-slot="skeleton"
      aria-busy="true"
      aria-live="polite"
      className={cn('animate-pulse rounded-md bg-muted/60', className)}
      {...props}
    />
  )
}
