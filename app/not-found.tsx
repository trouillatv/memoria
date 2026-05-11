import Link from 'next/link'
import { FileQuestion } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-background">
      <div className="text-center max-w-md">
        <div className="flex items-center justify-center rounded-full bg-muted/50 text-muted-foreground h-16 w-16 mb-6 mx-auto">
          <FileQuestion className="h-7 w-7" strokeWidth={1.5} />
        </div>
        <h1 className="text-xl font-semibold mb-2">Page introuvable</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Cette page n&apos;existe plus ou a été déplacée. Vos preuves restent en sécurité.
        </p>
        <Link href="/dashboard">
          <Button>Retour au tableau de bord</Button>
        </Link>
      </div>
    </div>
  )
}
