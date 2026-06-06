// Sprint 4 PC — Config admin de la Préparation du soir.
//
// MVP : Option C — la génération est toujours active, l'heure d'envoi est
// laissée à Maeva (elle ouvre /preparation manuellement le soir). Aucun cron
// n'est codé en V1 ; la doc dans docs/dev/preparation-cron.md explique comment
// l'activer plus tard si besoin.
//
// Cette page sert surtout à voir d'un coup d'œil quels chefs d'équipe ont
// leur téléphone renseigné. Doctrine V5 :
//   - Verrou V6 : aucune métrique d'usage ("dernière prep envoyée à...").
//   - Pas de "à relancer" ou "à former" : aucune mesure d'humain.

import Link from 'next/link'
import { Bell, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export const dynamic = 'force-dynamic'

interface ChefRow {
  id: string
  full_name: string | null
  phone: string | null
}

async function listChefsEquipe(): Promise<ChefRow[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, phone')
    .eq('role', 'chef_equipe')
    .is('deleted_at', null)
    .order('full_name', { ascending: true })
  if (error) throw error
  return (data ?? []) as ChefRow[]
}

export default async function AdminPreparationPage() {
  const chefs = await listChefsEquipe()
  const withPhone = chefs.filter((c) => Boolean(c.phone))
  const withoutPhone = chefs.filter((c) => !c.phone)

  return (
    <div className="space-y-6 w-full">
      <header>
        <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
          <Bell className="h-6 w-6 text-brand-600" />
          Préparation du soir — configuration
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          La préparation est calculée à la demande et consultée par Maeva sur{' '}
          <Link href="/preparation" className="underline">
            /preparation
          </Link>
          . Aucune mesure d&apos;usage n&apos;est conservée.
        </p>
      </header>

      {/* Config CRON — Option C : pas d'auto-send V1 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Génération automatique</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">Toujours disponible</p>
              <p className="text-xs text-muted-foreground">
                La page <code>/preparation</code> est à jour à chaque
                ouverture : Maeva la consulte le soir (vers 18h00 conseillé)
                et envoie chaque préparation par WhatsApp individuel.
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground italic border-l-2 border-muted pl-3">
            Le déclenchement automatique par cron (notification push à 18h)
            est documenté dans <code>docs/dev/preparation-cron.md</code> mais
            non activé en MVP : la doctrine V5 préfère un geste conscient
            humain plutôt qu&apos;un push automatisé.
          </p>
        </CardContent>
      </Card>

      {/* Téléphones — état */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base inline-flex items-center justify-between">
            <span>Téléphones des chefs d&apos;équipe</span>
            <span className="text-xs font-normal text-muted-foreground">
              {withPhone.length} / {chefs.length} renseigné
              {withPhone.length > 1 ? 's' : ''}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {chefs.length === 0 ? (
            <p className="text-sm italic text-muted-foreground">
              Aucun chef d&apos;équipe enregistré.
            </p>
          ) : (
            <ul className="divide-y text-sm">
              {chefs.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between py-2"
                >
                  <span className="font-medium">
                    {c.full_name ?? '—'}
                  </span>
                  {c.phone ? (
                    <span className="font-mono text-xs text-muted-foreground">
                      {c.phone}
                    </span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Badge className="bg-amber-100 text-amber-800 text-[10px] uppercase tracking-wider">
                        Numéro manquant
                      </Badge>
                      <Link
                        href="/admin/users"
                        className="text-xs text-amber-700 hover:underline"
                      >
                        Saisir
                      </Link>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {withoutPhone.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50/40 p-3 text-xs">
              <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
              <p className="text-amber-900">
                {withoutPhone.length} chef
                {withoutPhone.length > 1 ? 's' : ''} d&apos;équipe sans
                numéro. Saisissez-les sur{' '}
                <Link href="/admin/users" className="underline">
                  /admin/users
                </Link>{' '}
                pour permettre l&apos;envoi WhatsApp.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
