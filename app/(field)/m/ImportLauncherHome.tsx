import Link from 'next/link'
import { Download } from 'lucide-react'

/**
 * « Importer une visite » depuis l'accueil /m — la 2ᵉ porte d'entrée (mig 184).
 * Le sous-traitant envoie ses photos/vocaux sur WhatsApp comme d'habitude ; le
 * conducteur dépose l'export ici et retombe sur le MÊME tri que la visite en
 * direct. Cf. docs/ingestion-engine.md.
 */
export function ImportLauncherHome() {
  return (
    <Link
      href="/m/import"
      className="flex h-full w-full flex-col items-center justify-start gap-2.5 rounded-2xl bg-sky-50 px-2 py-5 text-center text-[13px] font-medium leading-snug text-sky-700 active:scale-[0.97] transition-transform dark:bg-sky-950/30 dark:text-sky-300"
    >
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/80 text-sky-600 dark:bg-white/10 dark:text-sky-300">
        <Download className="h-7 w-7" />
      </span>
      <span className="break-words">Importer une visite</span>
    </Link>
  )
}
