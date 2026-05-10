import { redirect } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { AppTopbar } from '@/components/layout/AppTopbar'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.must_change_password) redirect('/change-password')

  // chef_equipe (agent terrain) ne doit PAS voir le dashboard desktop.
  // Belt + suspenders avec le check role dans app/(field)/layout.tsx.
  if (user.role === 'chef_equipe') redirect('/m')

  const fullName = user.full_name || user.email
  return (
    <div className="min-h-screen bg-muted/20">
      <AppSidebar role={user.role} fullName={fullName} />
      <div className="md:pl-60">
        <AppTopbar fullName={fullName} />
        <main className="px-4 md:px-8 py-6 pb-24 md:pb-6">{children}</main>
      </div>
    </div>
  )
}
