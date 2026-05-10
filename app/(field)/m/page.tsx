import { getCurrentUserWithProfile } from '@/lib/db/users'

export default async function FieldHomePage() {
  const user = await getCurrentUserWithProfile()
  const baseName = user?.full_name ?? user?.email ?? ''
  const firstName = baseName.split(' ')[0] ?? ''

  return (
    <div className="space-y-4 max-w-md">
      <h1 className="text-xl font-semibold">Mes missions</h1>
      <p className="text-base text-muted-foreground">
        {firstName
          ? `${firstName}, la liste de vos missions du jour s'affichera ici.`
          : "La liste de vos missions du jour s'affichera ici."}
      </p>
      <p className="text-sm text-muted-foreground italic">
        (Slice 3.1 — à venir)
      </p>
    </div>
  )
}
