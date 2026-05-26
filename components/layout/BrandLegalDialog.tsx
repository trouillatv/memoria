'use client'

import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'

/**
 * Marque « MemorIA » de la sidebar → ouvre un pop-up « Mentions légales »
 * (grande icône + notices). Remplace l'ancien lien vers le dashboard.
 *
 * NB : les champs entre [crochets] sont à compléter avec les informations
 * légales réelles de l'éditeur (raison sociale, RIDET, directeur de publication).
 */
export function BrandLegalDialog() {
  return (
    <Dialog>
      <DialogTrigger
        aria-label="À propos de MemorIA — mentions légales"
        className="flex items-center gap-2 font-semibold rounded-md transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" className="h-7 w-7 shrink-0 rounded-md object-cover ring-1 ring-black/5" />
        <span>MemorIA</span>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader className="items-center text-center">
          {/* Grande icône (demande : « icône beaucoup plus grand ») */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="MemorIA"
            className="h-20 w-20 rounded-2xl object-cover ring-1 ring-black/5 shadow-sm"
          />
          <DialogTitle className="text-xl">MemorIA</DialogTitle>
          <DialogDescription>
            Mémoire opérationnelle augmentée · Nouvelle-Calédonie
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-left text-sm leading-relaxed text-muted-foreground">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground/70">
            Mentions légales
          </h3>

          <section className="space-y-1">
            <p className="font-medium text-foreground">Éditeur</p>
            <p>
              MemorIA est édité par Vincent Trouillat (personne physique),
              Nouvelle-Calédonie. Aucune société n&apos;est constituée à ce stade.
              Directeur de la publication : Vincent Trouillat.
            </p>
          </section>

          <section className="space-y-1">
            <p className="font-medium text-foreground">Contact</p>
            <p>
              <a href="mailto:trouillatv@gmail.com" className="underline underline-offset-2 hover:text-foreground">
                trouillatv@gmail.com
              </a>
            </p>
          </section>

          <section className="space-y-1">
            <p className="font-medium text-foreground">Hébergement</p>
            <p>
              Application hébergée par Vercel Inc. (Covina, Californie, États-Unis).
              Données opérationnelles hébergées via Supabase (PostgreSQL).
            </p>
          </section>

          <section className="space-y-1">
            <p className="font-medium text-foreground">Propriété intellectuelle</p>
            <p>
              La marque, le logo, les contenus et le code de MemorIA sont protégés.
              Toute reproduction ou réutilisation sans autorisation écrite est interdite.
            </p>
          </section>

          <section className="space-y-1">
            <p className="font-medium text-foreground">Données personnelles</p>
            <p>
              MemorIA traite des données d'exploitation (sites, interventions, équipes)
              pour assurer la continuité de la mémoire opérationnelle. Aucune donnée
              n'est revendue. Les consultations des fiches sont tracées. Droits d'accès,
              de rectification et de suppression exerçables via le contact ci-dessus.
            </p>
          </section>

          <section className="space-y-1">
            <p className="font-medium text-foreground">Cookies</p>
            <p>
              Seuls des cookies strictement nécessaires (session et authentification)
              sont utilisés. Aucun traceur publicitaire, aucun cookie tiers.
            </p>
          </section>

          <p className="pt-2 text-xs text-muted-foreground/70">
            © {new Date().getFullYear()} MemorIA — tous droits réservés.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
