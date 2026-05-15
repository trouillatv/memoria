import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role !== 'admin') redirect('/missions')

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="bg-slate-900 text-white border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-brand-600 flex items-center justify-center font-bold">N</div>
            <div>
              <div className="text-base font-semibold">MemorIA — Admin</div>
              <div className="text-xs text-slate-400">Gestion utilisateurs &amp; monitoring</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/admin/users"       className="text-xs text-slate-300 hover:text-white">Utilisateurs</Link>
            <Link href="/admin/preparation" className="text-xs text-slate-300 hover:text-white">Préparation</Link>
            <Link href="/admin/monitoring"  className="text-xs text-slate-300 hover:text-white">Monitoring</Link>
            <Link href="/missions"          className="text-xs text-slate-400 hover:text-white">← Retour app</Link>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 md:px-8 py-6 md:py-8">{children}</main>
    </div>
  )
}
