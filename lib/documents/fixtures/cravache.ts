// Fixture de RÉFÉRENCE — CR La Cravache (Mont-Dore), reconstruit en JSON depuis
// les CR réels BECIB (docs/Becib : LA CRAVACHE GDE - PV 04). Sert de « gold
// standard » : si le gabarit re-rend ce JSON ~1:1 avec le PDF original, la
// charte est juste. Comparer page à page (méthode du brief).

import type { CrBecib } from '@/lib/documents/cr-becib-schema'

export const CRAVACHE_FIXTURE: CrBecib = {
  meta: {
    numeroCR: '04',
    dateIso: '2025-11-07',
    semaine: '45',
    projetTitre:
      "TRAVAUX POUR L'AMÉLIORATION DE LA GESTION DES EAUX PLUVIALES DU CENTRE ÉQUESTRE « LA CRAVACHE » À PLUM",
    moa: 'Mairie du MONT-DORE',
    moe: 'BECIB',
    chantier: 'LA CRAVACHE GDE',
    dns: '2025BEC010/CR004',
    version: '1',
    modification: 'A',
    clientLogoDataUrl: null,
  },
  intervenants: [
    // Données alignées sur le PV04 RÉEL : chaque intervenant a ~3 croix =
    // I (invité) + P/AE (présence) + D (diffusion). Tous conviés → invite=true.
    { groupe: 'MOA', organisme: 'Mairie du MONT-DORE', representant: 'M. KATJAWAN', tel: '43.72.23', mob: '73.53.93', email: 'jocelyn.katjawan@ville-montdore.nc', invite: true, presence: 'AE', diffusion: true },
    { groupe: 'MOE', organisme: 'BECIB', representant: 'Mme DEVALLEZ', tel: '27 85 78', mob: '75.23.28', email: 'e.devallez@becib.nc', invite: true, presence: 'P', diffusion: true },
    { groupe: 'ENTREPRISE', organisme: 'ETV', representant: 'M. VERDEGEM', tel: '77.90.22', mob: null, email: 'etv@etv.nc', invite: true, presence: 'P', diffusion: true },
    { groupe: 'ENTREPRISE', organisme: 'ETV', representant: 'M. MERIEL', tel: '76.18.10', mob: null, email: 'Assist.pilote2@etv.nc', invite: true, presence: 'P', diffusion: true },
    { groupe: 'PARTENAIRES', organisme: 'LA CRAVACHE', representant: 'M. VALEE Eric', tel: '93.12.33', mob: null, email: null, invite: true, presence: 'P', diffusion: true },
    { groupe: 'PARTENAIRES', organisme: 'LA CRAVACHE', representant: 'Mme CHUQUET', tel: '53.46.12', mob: null, email: null, invite: true, presence: 'P', diffusion: true },
  ],
  ordreDuJour: ['Suivi des travaux.'],
  remarquesCrPrecedent:
    "Le CR 03 a été corrigé afin de noter l'absence excusée de M. KATJAWAN.",
  pointsExamines: {
    administratifs: [
      { sousTitre: 'CONTRAT', action: [], points: [
        { texte: 'Démarrage en date du **13/10/2025**. Durée des travaux 1 mois.', statut: null, action: [] },
      ] },
      { sousTitre: 'SOUS-TRAITANCE', action: [], points: [
        { texte: 'De manière générale, déclaration de sous-traitance à fournir avec les documents administratifs.', statut: null, action: [] },
      ] },
      { sousTitre: 'MOA', action: ['ETV'], points: [
        { texte: "Situation de travaux = facture de l'entreprise accompagnée du DQE visé par le MOE.", statut: null, action: [] },
      ] },
    ],
    techniques: [
      { sousTitre: 'TRAVAUX PRÉLIMINAIRES, ESSAIS / CONTRÔLE', action: [], points: [
        { texte: 'Fourniture du PAQ', statut: 'fait', action: [] },
        { texte: "Réunion de coordination avant démarrage avec l'exploitant (vendredi 10/10/2025)", statut: 'fait', action: [] },
        { texte: "Zone de stockage à définir en concertation avec l'exploitant", statut: 'OK', action: [] },
        { texte: 'Autorisation de voirie pour les traversées', statut: 'OK', action: [] },
        { texte: 'Transmettre les fiches techniques des matériaux avant mise en œuvre', statut: 'OK', action: [] },
        { texte: 'DOE : fiches techniques et d\'agrément, essais et contrôles, plans de récolement, journal de chantier, note sur l\'entretien des ouvrages', statut: 'à faire', action: [] },
      ] },
      { sousTitre: 'TERRASSEMENTS GÉNÉRAUX', action: ['ETV'], points: [
        { texte: "Au besoin, balisage par ETV du chemin entre boxes amont et carrière pour lisibilité de l'exploitant pendant la durée des travaux sur les paddocks.", statut: 'en cours', action: [] },
        { texte: "Abri dans le paddock à déplacer par l'exploitant = devis demandé à l'entreprise.", statut: 'en cours', action: [] },
        { texte: 'Mise en œuvre de la GNT devant les boxes CLUB (constat le 24/11 OK pour tous).', statut: 'à faire', action: [] },
        { texte: 'Mise en œuvre de la GNT devant les boxes POLICE : **travaux modificatifs à décider le 14/11 selon constat sur site en présence de tous.**', statut: 'attente décision', action: ['MOA'] },
        { texte: 'Mise en œuvre du C1B3 sur la piste le long des paddocks Sud', statut: 'en cours', action: [] },
      ] },
      { sousTitre: 'ASSAINISSEMENT', action: ['ETV'], points: [
        { texte: 'Traversée busée et fossés projetés en amont des boxes', statut: 'en cours', action: [] },
        { texte: 'Cunettes en cours. État du béton OK, propreté générale OK. Attention aux pentes des ouvrages.', statut: 'en cours', action: [] },
      ] },
      { sousTitre: 'DIVERS', action: ['ETV'], points: [
        { texte: "Attention, coactivité avec l'entreprise BAJA ; remettre en forme le terrain préparé par ETV. **URGENT, récolements ETV dans 2 semaines.**", statut: 'à faire', action: [] },
        { texte: 'Attention à la poussière.', statut: null, action: [] },
      ] },
    ],
  },
  avancement: {
    fait: ['Reprofilage des paddocks achevé la semaine dernière.', 'Mise en œuvre de la scorie sur la carrière en cours.'],
    previsions: ['Poursuite des cunettes et têtes d\'ouvrage.', 'Récolements sous 2 semaines.'],
  },
  intemperiesAleas: ['RAS sur la période.'],
  planning: {
    marche: { osDemarrage: '13/10/2025', delai: '1 mois', finContractuelle: '12/11/2025' },
    intemperies: { depuisDerniereReunion: '0 j', cumulOuvrable: '0 j', finAvecIntemperies: '12/11/2025' },
    prolongations: null,
    retard: { previsionnel: null, effectif: null },
  },
  securite: [
    'Port des EPI obligatoire sur la zone de travaux.',
    'Balisage du chemin entre boxes maintenu pendant les travaux.',
    'Blindage de tranchée à prévoir selon profondeur.',
  ],
  photos: [],
  photosComment: null,
  prochaineReunion: { date: '14/11/2025', heure: '09h00', lieu: 'Sur site — La Cravache' },
  signature: 'POUR BECIB, E. DEVALLEZ',
}
