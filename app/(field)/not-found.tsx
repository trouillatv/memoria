import Link from 'next/link'
import { FileQuestion } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'

export default function FieldNotFound() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <EmptyState
        icon={FileQuestion}
        title="Page introuvable"
        description="Cette intervention n'existe pas ou vous n'y avez pas accès."
        primaryAction={
          <Link href="/m">
            <Button>Retour à mes missions</Button>
          </Link>
        }
        variant="compact"
      />
    </div>
  )
}
