// Fixture RÉALISTE d'une réunion MemorIA (forme proche d'un site_report réel),
// pour tester le flux complet réunion → CrBecib → DOCX → PDF. Chantier différent
// de Cravache (prouve le générique). Contient des TROUS volontaires (action sans
// responsable, participant sans organisme) pour démontrer le filet detectPvGaps.

import type { MeetingInput } from '@/lib/documents/meeting-to-cr-becib'

export const MEETING_BECIB: MeetingInput = {
  numeroCR: '02',
  report: {
    title: 'Réunion de chantier n°2 — Aménagement parking école de PLUM',
    createdAt: '2026-03-12',
    participants: [
      { name: 'M. TANEArt', role: 'Maire adjoint', organisme: 'Mairie du MONT-DORE', groupe: 'MOA', presence: 'P' },
      { name: 'Mme DEVALLEZ', role: 'Maître d\'œuvre', organisme: 'BECIB', groupe: 'MOE', presence: 'P' },
      { name: 'M. ROUSSEL', role: 'Conducteur de travaux', organisme: 'COLAS', groupe: 'ENTREPRISE', presence: 'P' },
      { name: 'M. BAKER', role: 'Chef de chantier', organisme: 'COLAS', groupe: 'ENTREPRISE', presence: 'AE' },
      { name: 'M. WATSON', role: 'Riverain référent', presence: 'P' }, // organisme MANQUANT → gap
    ],
  },
  site: { name: 'PARKING ÉCOLE DE PLUM', dns: '2026BEC004/CR002' },
  contract: { name: "TRAVAUX D'AMÉNAGEMENT DU PARKING DE L'ÉCOLE DE PLUM", clientName: 'Mairie du MONT-DORE', startDate: '03/03/2026', delai: '2 mois', endDate: '02/05/2026' },
  contacts: [
    { fullName: 'M. TANEArt', phone: '43.10.20', mob: '78.10.20', email: 'taneart@ville-montdore.nc' },
    { fullName: 'Mme DEVALLEZ', phone: '27 85 78', mob: '75.23.28', email: 'e.devallez@becib.nc' },
    { fullName: 'M. ROUSSEL', mob: '79.44.10', email: 'roussel@colas.nc' },
  ],
  actions: [
    { title: 'Transmettre le PAQ et les fiches techniques enrobés', assignedTo: 'COLAS', dueDate: '2026-03-20', dueDateStatus: 'explicit', status: 'open' },
    { title: 'Valider l\'implantation des places PMR', assignedTo: null, dueDate: '2026-03-18', dueDateStatus: 'explicit', status: 'open' }, // responsable MANQUANT → gap
    { title: 'Fournir le plan de récolement réseaux', assignedTo: 'COLAS', dueDate: null, dueDateStatus: null, status: 'open' }, // échéance MANQUANTE → gap
  ],
  ordreDuJour: ['Suivi des travaux de terrassement et voirie.'],
  remarquesCrPrecedent: 'Le CR 01 a été diffusé sans observation sous 48h.',
  pointsAdmin: [
    { sousTitre: 'CONTRAT', action: [], points: [{ texte: 'Ordre de service de démarrage notifié le **03/03/2026**. Durée 2 mois.', statut: null, action: [] }] },
    { sousTitre: 'SOUS-TRAITANCE', action: ['MOE'], points: [{ texte: 'Déclaration de sous-traitance pour la signalisation horizontale à fournir.', statut: 'à faire', action: [] }] },
  ],
  pointsTech: [
    { sousTitre: 'TERRASSEMENTS', action: ['ETV'], points: [
      { texte: 'Décapage de la terre végétale réalisé sur l\'emprise du parking.', statut: 'fait', action: [] },
      { texte: 'Mise en œuvre de la GNT en cours, contrôle de compactage à programmer.', statut: 'en cours', action: [] },
    ] },
    { sousTitre: 'ASSAINISSEMENT PLUVIAL', action: ['ETV'], points: [
      { texte: 'Pose des regards et canalisations EP. **Attention au calage altimétrique des fils d\'eau.**', statut: 'en cours', action: [] },
    ] },
  ],
  prochaineReunion: { date: null, heure: '09h00', lieu: 'Sur site — école de Plum' }, // date MANQUANTE → gap
}
