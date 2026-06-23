// Vocabulaire métier de DÉMARRAGE (BTP / VRD + MOE chantier) — données PURES,
// aucune dépendance serveur (importable client & serveur). Sert deux buts :
//   1. Donner un glossaire utile dès le départ (la page le promettait sans le livrer).
//   2. Nourrir les corrections de transcription (alias = fautes/variantes fréquentes).
//
// Doctrine : référentiel manuel, à adapter par chaque organisation. Les `term`
// sont la forme canonique (ce que MemorIA écrit) ; les `aliases` sont les
// variantes/fautes que la transcription produit (« finisher » → « Finisseur »).
// On NE mappe PAS les formes longues vers les sigles (on corrige des fautes, on
// ne réécrit pas le style). Catégories : engin / matériau / document / processus
// / contrôle / acteur.

export interface GlossarySeedTerm {
  term: string
  definition: string
  category: string
  aliases: string[]
}

export const DEFAULT_GLOSSARY: GlossarySeedTerm[] = [
  // ── Documents ──────────────────────────────────────────────────────────────
  { term: 'DOE', category: 'document', definition: 'Dossier des Ouvrages Exécutés — le dossier remis en fin de chantier (plans conformes, notices, garanties).', aliases: ['d.o.e', 'doé'] },
  { term: 'DGD', category: 'document', definition: 'Décompte Général Définitif — le solde financier définitif du marché.', aliases: ['d.g.d'] },
  { term: 'GPA', category: 'document', definition: 'Garantie de Parfait Achèvement — un an après réception, l’entreprise reprend les désordres signalés.', aliases: ['g.p.a'] },
  { term: 'PAQ', category: 'document', definition: 'Plan d’Assurance Qualité — l’organisation qualité que l’entreprise s’engage à tenir.', aliases: ['p.a.q', 'pac'] },
  { term: 'OPR', category: 'processus', definition: 'Opérations Préalables à la Réception — la visite où la MOE relève les réserves avant de réceptionner.', aliases: ['o.p.r'] },
  { term: 'PV', category: 'document', definition: 'Procès-Verbal — compte-rendu officiel et opposable (réunion, réception, OPR…).', aliases: ['p.v', 'pévé', 'procès verbal', 'proces verbal'] },
  { term: 'CR', category: 'document', definition: 'Compte-Rendu — relevé des échanges et décisions d’une réunion de chantier.', aliases: ['c.r', 'compte rendu', 'compte-rendu'] },
  { term: 'CCTP', category: 'document', definition: 'Cahier des Clauses Techniques Particulières — les exigences techniques du marché.', aliases: ['c.c.t.p'] },
  { term: 'CCAP', category: 'document', definition: 'Cahier des Clauses Administratives Particulières — les règles administratives du marché.', aliases: ['c.c.a.p'] },
  { term: 'DICT', category: 'document', definition: 'Déclaration d’Intention de Commencement de Travaux — déclaration aux concessionnaires de réseaux avant de creuser.', aliases: ['d.i.c.t'] },
  { term: 'OS', category: 'document', definition: 'Ordre de Service — instruction écrite du maître d’œuvre (démarrer, arrêter, modifier).', aliases: ['o.s', 'ordre de service'] },
  { term: 'PPSPS', category: 'document', definition: 'Plan Particulier de Sécurité et de Protection de la Santé — le plan sécurité de l’entreprise sur le chantier.', aliases: ['p.p.s.p.s'] },

  // ── Acteurs ────────────────────────────────────────────────────────────────
  { term: 'MOE', category: 'acteur', definition: 'Maître d’Œuvre — conçoit et dirige l’exécution des travaux pour le compte du maître d’ouvrage.', aliases: ['m.o.e', 'maitre d’oeuvre', 'maître d’oeuvre', 'maitre d’œuvre'] },
  { term: 'MOA', category: 'acteur', definition: 'Maître d’Ouvrage — le client donneur d’ordre, propriétaire de l’ouvrage.', aliases: ['m.o.a', 'maitre d’ouvrage', 'maître d’ouvrage'] },
  { term: 'OPC', category: 'acteur', definition: 'Ordonnancement, Pilotage, Coordination — coordonne le planning des différents corps d’état.', aliases: ['o.p.c'] },
  { term: 'CSPS', category: 'acteur', definition: 'Coordonnateur Sécurité et Protection de la Santé — prévient les risques liés à la coactivité.', aliases: ['c.s.p.s', 'coordonnateur sps'] },
  { term: 'Bureau de contrôle', category: 'acteur', definition: 'Organisme agréé qui vérifie la conformité technique et la solidité de l’ouvrage.', aliases: ['bureau de controle', 'bureau contrôle'] },

  // ── Engins ─────────────────────────────────────────────────────────────────
  { term: 'Finisseur', category: 'engin', definition: 'Engin qui répand et règle l’enrobé en couche régulière sur la chaussée.', aliases: ['finisher', 'finiseur', 'finisseuse'] },
  { term: 'Niveleuse', category: 'engin', definition: 'Engin à lame (grader) qui règle finement les niveaux de la plateforme.', aliases: ['grader', 'gradeur'] },
  { term: 'Compacteur', category: 'engin', definition: 'Rouleau qui compacte les couches (remblai, grave, enrobé) pour atteindre la densité requise.', aliases: ['rouleau compresseur', 'rouleau compacteur', 'compacteuse'] },
  { term: 'Pelle hydraulique', category: 'engin', definition: 'Engin de terrassement à godet (excavation, chargement, tranchées).', aliases: ['pelleteuse', 'pelle mécanique'] },

  // ── Matériaux ──────────────────────────────────────────────────────────────
  { term: 'Grave-bitume', category: 'matériau', definition: 'Matériau de couche de base : graves liées au bitume (GB).', aliases: ['grave bitume', 'grave bitumineux'] },
  { term: 'GNT', category: 'matériau', definition: 'Grave Non Traitée — graves non liées, utilisées en couche de fondation/base.', aliases: ['g.n.t', 'grave non traitée', 'grave non traitee'] },
  { term: 'Enrobé', category: 'matériau', definition: 'Mélange de granulats et de bitume pour la couche de roulement (ex. BBSG).', aliases: ['enrobe', 'enrobé bitumineux', 'bbsg'] },
  { term: 'BPE', category: 'matériau', definition: 'Béton Prêt à l’Emploi — béton livré par toupie depuis une centrale.', aliases: ['b.p.e', 'béton prêt à l’emploi'] },

  // ── Processus ──────────────────────────────────────────────────────────────
  { term: 'Terrassement', category: 'processus', definition: 'Travaux de modification du relief : déblais, remblais, mise à niveau de la plateforme.', aliases: ['terassement'] },
  { term: 'Compactage', category: 'processus', definition: 'Densification d’une couche par passage de compacteur jusqu’à la portance visée.', aliases: ['compactation'] },
  { term: 'Réception', category: 'processus', definition: 'Acte par lequel le maître d’ouvrage accepte l’ouvrage, avec ou sans réserves. Point de départ des garanties.', aliases: ['réception des travaux', 'reception'] },
  { term: 'Levée de réserves', category: 'processus', definition: 'Correction et validation d’une réserve émise à la réception. Vocabulaire « levée », jamais « résolu ».', aliases: ['levée de réserve', 'levee de reserves', 'levee de reserve'] },
  { term: 'Retenue de garantie', category: 'processus', definition: 'Part du paiement conservée (souvent 5 %) en garantie de la bonne exécution, libérée après la GPA.', aliases: ['retenue garantie'] },
]
