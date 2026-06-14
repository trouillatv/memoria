import Link from 'next/link'
import { Building2, Phone, Mail, ChevronRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { listClientsWithStats } from '@/lib/db/clients'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { redirect } from 'next/navigation'

export default async function ClientsPage() {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role !== 'admin' && user.role !== 'manager') redirect('/dashboard')

  const clients = await listClientsWithStats()

  return (
    <div className="space-y-6 w-full">
      <header>
        <h1 className="text-2xl font-semibold">Clients</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Vue agrégée par client — contrats, sites et activité.
        </p>
      </header>

      {clients.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Aucun client"
          description="Les clients sont créés automatiquement lors de l'ajout de sites."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {clients.map((client) => (
            <li key={client.id}>
              <Link href={`/clients/${client.id}`} className="group block h-full">
                <Card className="h-full hover:border-foreground/30 transition-colors">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm leading-tight truncate group-hover:text-foreground">
                          {client.name}
                        </p>
                        {client.contact_name && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {client.contact_name}
                          </p>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground mt-0.5 transition-colors" />
                    </div>

                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      {client.contractCount > 0 && (
                        <span>{client.contractCount} contrat{client.contractCount > 1 ? 's' : ''}</span>
                      )}
                      {client.siteCount > 0 && (
                        <span>{client.siteCount} site{client.siteCount > 1 ? 's' : ''}</span>
                      )}
                      {client.contractCount === 0 && client.siteCount === 0 && (
                        <span className="italic">Aucun site ni contrat</span>
                      )}
                    </div>

                    {(client.contact_phone || client.contact_email) && (
                      <div className="flex items-center gap-3 flex-wrap">
                        {client.contact_phone && (
                          <a
                            href={`tel:${client.contact_phone}`}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <Phone className="h-3 w-3" />
                            {client.contact_phone}
                          </a>
                        )}
                        {client.contact_email && (
                          <a
                            href={`mailto:${client.contact_email}`}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <Mail className="h-3 w-3" />
                            <span className="truncate max-w-[140px]">{client.contact_email}</span>
                          </a>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
