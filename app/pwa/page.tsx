import { redirect } from 'next/navigation'

/**
 * Point d'entrée permanent de la PWA installée (start_url='/pwa' dans le manifest).
 * Redirige systématiquement vers /m — si la route terrain change un jour,
 * on met à jour ici, pas dans le manifest (le WebAPK n'a plus besoin d'être réinstallé).
 */
export default function PwaEntry() {
  redirect('/m')
}
