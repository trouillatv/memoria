// LE PDF DU COMPTE-RENDU, À L'ADRESSE DU BUREAU.
//
// Le générateur vit côté terrain et n'est pas dupliqué : cette route ne fait que
// l'appeler avec le même identifiant de visite. Sans elle, télécharger le CR
// depuis le poste de travail affichait une URL `/m/...` — le conducteur croyait
// être renvoyé dans l'application mobile.
//
// Un seul moteur, deux adresses : c'est la règle tenue partout ailleurs.

import { GET as genererLePdf } from '@/app/(field)/m/visite/[reportId]/pdf/route'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(req: Request, ctx: { params: Promise<{ id: string; visitId: string }> }) {
  const { visitId } = await ctx.params
  return genererLePdf(req, { params: Promise.resolve({ reportId: visitId }) })
}
