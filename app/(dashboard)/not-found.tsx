import Link from 'next/link'
import { FileQuestion } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'

export default function DashboardNotFound() {
  return (
    <div className="max-w-3xl mx-auto py-8">
      <EmptyState
        icon={FileQuestion}
        title="Page introuvable"
        description="Cette ressource n'existe plus ou vous n'y avez plus accès. Vos preuves restent en sécurité dans votre espace."
        primaryAction={
          <Link href="/dashboard">
            <Button>Retour au tableau de bord</Button>
          </Link>
        }
      />
    </div>
  )
}
