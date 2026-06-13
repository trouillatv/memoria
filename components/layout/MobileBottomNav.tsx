import Link from 'next/link'
import { ClipboardList, Camera, User } from 'lucide-react'

export function MobileBottomNav() {
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 border-t bg-card flex justify-around py-2 z-10">
      <Link href="/missions" className="flex flex-col items-center text-xs gap-1">
        <ClipboardList className="h-5 w-5" />
        <span>Missions</span>
      </Link>
      <Link href="/missions" className="flex flex-col items-center text-xs gap-1">
        <Camera className="h-5 w-5" />
        <span>Photos</span>
      </Link>
      <Link href="/account" className="flex flex-col items-center text-xs gap-1">
        <User className="h-5 w-5" />
        <span>Profil</span>
      </Link>
    </nav>
  )
}
