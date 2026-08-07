import { Minus, Plus, Maximize2, Shuffle } from 'lucide-react'

interface Props {
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  onReorganize?: () => void
  className?: string
}

export function GraphToolbar({ onZoomIn, onZoomOut, onFit, onReorganize, className }: Props) {
  return (
    <div className={`flex flex-col gap-1 ${className ?? ''}`}>
      <button
        type="button"
        aria-label="Zoomer"
        onClick={onZoomIn}
        className="flex h-8 w-8 items-center justify-center rounded-lg border bg-background/80 shadow-sm backdrop-blur-sm active:bg-muted"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        aria-label="Dézoomer"
        onClick={onZoomOut}
        className="flex h-8 w-8 items-center justify-center rounded-lg border bg-background/80 shadow-sm backdrop-blur-sm active:bg-muted"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        aria-label="Recentrer"
        onClick={onFit}
        className="flex h-8 w-8 items-center justify-center rounded-lg border bg-background/80 shadow-sm backdrop-blur-sm active:bg-muted"
      >
        <Maximize2 className="h-3.5 w-3.5" />
      </button>
      {onReorganize && (
        <button
          type="button"
          aria-label="Réorganiser"
          onClick={onReorganize}
          className="flex h-8 w-8 items-center justify-center rounded-lg border bg-background/80 shadow-sm backdrop-blur-sm active:bg-muted"
        >
          <Shuffle className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
