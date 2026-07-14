import { redirect } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import type { DbUser } from '@/types/db'

/**
 * Le garde des pages de BUREAU (admin, manager).
 *
 * Pourquoi un helper alors que chaque page savait déjà se garder elle-même :
 * parce qu'elle le savait UNE PAR UNE. Le menu masque à un chef d'équipe tout
 * ce qui n'est pas /planning et /glossaire — mais masquer n'est pas interdire.
 * Quinze pages avaient été oubliées (contrats, dossiers de démarrage,
 * bibliothèque, fiche client, photos du chantier) : il suffisait de taper
 * l'URL. Une défense qu'il faut réécrire à la main quatre-vingt-treize fois
 * finit toujours par être oubliée une fois de plus.
 *
 * Le chef d'équipe est renvoyé vers /m — chez lui, le terrain — et non vers une
 * page d'erreur : il n'a rien fait de mal, il n'est simplement pas au bureau.
 *
 * Le test tests/doctrine/dashboard-role-gates.test.ts vérifie qu'aucune page du
 * dashboard n'échappe à ce garde sans être inscrite explicitement comme ouverte.
 */
export async function requireDeskUser(): Promise<DbUser> {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role !== 'admin' && user.role !== 'manager') redirect('/m')
  return user
}
