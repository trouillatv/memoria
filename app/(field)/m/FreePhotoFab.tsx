'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Camera, MapPin } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'

/**
 * V5.1 Slice 1 — FAB "+ Photo libre" sur /m.
 *
 * Comportement :
 *   - 0 site connu → composant ne s'affiche pas (caller ne le rend pas)
 *   - 1 site connu → bouton-lien direct vers /m/site/[id], pas de modal
 *   - 2+ sites connus → bouton ouvre un Sheet bottom avec la liste, tap → /m/site/[id]
 *
 * Grammaire sensorielle V5.1 :
 *   - FAB pleine-largeur en bas (sticky safe-area)
 *   - Touch target 80px sur le FAB et 64px sur chaque ligne du sélecteur
 *   - Wording sobre "Photo libre sur un site", pas de "Rapide" / "Express"
 */

export interface FreePhotoFabSite {
  id: string
  name: string
}

export function FreePhotoFab({ sites }: { sites: FreePhotoFabSite[] }) {
  const [open, setOpen] = useState(false)

  if (sites.length === 0) return null

  // 1 site → link direct, pas de modal
  if (sites.length === 1) {
    return (
      <div className="fixed inset-x-0 bottom-0 p-4 bg-background border-t safe-bottom">
        <Link
          href={`/m/site/${sites[0].id}`}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-foreground text-background font-semibold text-base active:scale-[0.98] transition-transform shadow-lg"
          style={{ minHeight: 80 }}
        >
          <Camera className="h-6 w-6" />
          Photo libre sur {sites[0].name}
        </Link>
      </div>
    )
  }

  // 2+ sites → Sheet sélecteur
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <div className="fixed inset-x-0 bottom-0 p-4 bg-background border-t safe-bottom">
        <SheetTrigger
          render={
            <button
              type="button"
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-foreground text-background font-semibold text-base active:scale-[0.98] transition-transform shadow-lg"
              style={{ minHeight: 80 }}
            />
          }
        >
          <Camera className="h-6 w-6" />
          Photo libre sur un site
        </SheetTrigger>
      </div>

      <SheetContent side="bottom" className="max-h-[80vh]">
        <SheetHeader className="text-left">
          <SheetTitle>Sur quel site ?</SheetTitle>
        </SheetHeader>
        <ul className="mt-4 space-y-2">
          {sites.map((s) => (
            <li key={s.id}>
              <Link
                href={`/m/site/${s.id}`}
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-4 py-4 rounded-lg border bg-card active:bg-muted/50"
                style={{ minHeight: 64 }}
              >
                <MapPin className="h-5 w-5 text-muted-foreground shrink-0" />
                <span className="font-medium text-base">{s.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  )
}
