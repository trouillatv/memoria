'use client'

import { Button } from '@/components/ui/button'
import { Archive } from 'lucide-react'
import { archiveTenderAction } from './actions'
import { toast } from 'sonner'

export function ArchiveTenderButton({ tenderId }: { tenderId: string }) {
  async function onClick() {
    if (!confirm('Archiver cet appel d\'offres ? Il disparaîtra de la liste mais reste en base (soft delete).')) return
    const fd = new FormData()
    fd.set('id', tenderId)
    const r = await archiveTenderAction(fd)
    // Success path : Server Action redirects to /tenders, on n'arrive pas ici.
    // Si on arrive ici, c'est qu'il y a eu une erreur.
    if (r && 'error' in r) toast.error(r.error)
  }

  return (
    <Button variant="outline" size="sm" onClick={onClick} className="text-rose-700 hover:text-rose-800 hover:bg-rose-50">
      <Archive className="h-3 w-3 mr-1" />
      Archiver
    </Button>
  )
}
