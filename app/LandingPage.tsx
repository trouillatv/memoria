import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  ArrowRightLeft,
  BriefcaseBusiness,
  Building2,
  Camera,
  FileArchive,
  FileText,
  KeyRound,
  Layers3,
  MapPinned,
  ShieldCheck,
} from 'lucide-react'
import { HeroCardTilt } from './HeroCardTilt'

const demoHref = 'mailto:trouillatv@gmail.com?subject=Demande%20de%20d%C3%A9mo%20MemorIA'

const memoryItems = [
  {
    label: 'Acces',
    text: 'Badges, codes, points de contact et contraintes d entree.',
    icon: KeyRound,
  },
  {
    label: 'A savoir',
    text: 'Consignes terrain, horaires sensibles, zones a traiter avec attention.',
    icon: FileText,
  },
  {
    label: 'Anomalies',
    text: 'Signalements, recurrence, contexte et etat de traitement.',
    icon: AlertTriangle,
  },
  {
    label: 'Preuves',
    text: 'Photos, passages documentes, dossiers exportables et traces utiles.',
    icon: Camera,
  },
  {
    label: 'Passations',
    text: 'Ce qu une equipe doit savoir avant de reprendre un site.',
    icon: ArrowRightLeft,
  },
  {
    label: 'Références dossiers',
    text: 'Experiences comparables, interventions datees et preuves mobilisables.',
    icon: FileArchive,
  },
]

const surfacedSignals = [
  {
    icon: AlertTriangle,
    tone: 'border-amber-200 bg-amber-50 text-amber-700',
    title: 'Dumbea Mall - Hall principal',
    text: 'Robinet signale en octobre, fuite notee en janvier, moisissure photographiee en mars. Trois signalements distincts deviennent un seul probleme relie.',
    signal: 'Anomalie recurrente detectee',
  },
  {
    icon: ArrowRightLeft,
    tone: 'border-slate-300 bg-slate-100 text-slate-700',
    title: 'Equipe Noumea Centre - releve a preparer',
    text: 'Un contrat se termine dans 18 jours. La memoire de 4 sites, dont le Medipole, repose encore sur cette equipe.',
    signal: 'Brief de passation pret',
  },
  {
    icon: Layers3,
    tone: 'border-blue-200 bg-blue-50 text-blue-700',
    title: 'Dossier de démarrage - marché de services multi-sites',
    text: 'Le critere tracabilite des passages est exige. MemorIA retrouve des interventions documentees sur des sites comparables.',
    signal: 'References terrain disponibles',
  },
]

const fragileMoments = [
  'Une personne experimentee quitte l entreprise et emporte ce qu elle savait du site.',
  'Une equipe reprend une zone sensible sans contexte exploitable.',
  'Un client conteste une prestation et les preuves sont dispersees.',
]

const gains = [
  {
    title: 'Continuite d exploitation',
    text: 'Les departs, fins de contrat et changements d equipe ne creent plus de page blanche.',
    icon: Building2,
  },
  {
    title: 'Dossiers de preuves',
    text: 'Les passages documentes, photos et signalements restent mobilisables en quelques secondes.',
    icon: ShieldCheck,
  },
  {
    title: 'Dossiers de démarrage mieux argumentés',
    text: 'Les references terrain datees ressortent au moment ou un marche demande de la tracabilite.',
    icon: BriefcaseBusiness,
  },
]

export default function LandingPage() {
  return (
    <div className="force-light-theme min-h-screen bg-[#eef1f3] text-[#26313b] [--ease-out-landing:cubic-bezier(0.23,1,0.32,1)]">
      {/* Couche d'animations — moderne, sobre, hardware-accelerée.
          - .landing-fadeup       : entrée fade+translate (480ms ease-out fort)
          - .landing-reveal       : même chose mais déclenchée au scroll via
                                    animation-timeline:view() (Chrome/Edge/Safari
                                    récents). Fallback navigateurs anciens : joue
                                    une fois au load, élément se stabilise visible.
          - .landing-pulse-soft   : pulse lente (opacité + scale très léger) pour
                                    un détail vivant (icône hat hero, badge état).
          - Tout est désactivé sous prefers-reduced-motion. */}
      <style>{`
        @keyframes landing-fadeup {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes landing-pulse-soft {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.55; transform: scale(0.92); }
        }
        .landing-fadeup {
          animation: landing-fadeup 520ms var(--ease-out-landing) backwards;
        }
        .landing-reveal {
          animation: landing-fadeup linear both;
          animation-timeline: view();
          animation-range: entry 0% cover 30%;
        }
        @supports not (animation-timeline: view()) {
          /* Fallback : on joue l'animation une fois à 520ms ; les éléments
             en bas de page apparaissent visibles directement (acceptable). */
          .landing-reveal {
            animation: landing-fadeup 520ms var(--ease-out-landing) both;
          }
        }
        .landing-pulse-soft {
          animation: landing-pulse-soft 2.8s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .landing-fadeup,
          .landing-reveal,
          .landing-pulse-soft { animation: none; }
        }
      `}</style>
      <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-[#f8fafb]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="MemorIA"
              className="h-8 w-8 rounded-md object-cover ring-1 ring-slate-900/10"
            />
            <span className="text-base font-semibold tracking-tight text-slate-950">
              MemorIA
            </span>
          </div>
          <Link
            href="/login"
            className="group inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 transition-colors duration-200 hover:text-slate-950"
          >
            Se connecter
            <ArrowRight className="h-4 w-4 transition-transform duration-200 ease-[var(--ease-out-landing)] motion-safe:group-hover:translate-x-0.5" />
          </Link>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl gap-12 px-5 py-16 md:grid-cols-[1.02fr_0.98fr] md:items-center md:py-24">
          <div className="max-w-2xl">
            <div
              className="landing-fadeup mb-6 inline-flex items-center gap-2 border border-slate-300 bg-white/70 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600"
              style={{ animationDelay: '0ms' }}
            >
              <MapPinned className="landing-pulse-soft h-3.5 w-3.5" />
              Memoire operationnelle - Nouvelle-Caledonie
            </div>
            <h1
              className="landing-fadeup text-4xl font-semibold leading-[0.98] tracking-tight text-slate-950 md:text-6xl"
              style={{ animationDelay: '80ms' }}
            >
              La memoire des lieux ne doit plus partir avec les personnes.
            </h1>
            <p
              className="landing-fadeup mt-6 text-lg leading-8 text-slate-600"
              style={{ animationDelay: '180ms' }}
            >
              MemorIA conserve les acces, a-savoir, anomalies, preuves et
              passations de chaque site, puis les fait remonter au moment ou une
              equipe, un contrat ou un nouveau dossier en a besoin.
            </p>
            <div
              className="landing-fadeup mt-8 flex flex-wrap gap-3"
              style={{ animationDelay: '280ms' }}
            >
              <a
                href={demoHref}
                className="group inline-flex items-center gap-2 rounded-lg bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-sm transition-[background-color,transform,box-shadow] duration-200 ease-[var(--ease-out-landing)] hover:bg-slate-800 hover:shadow-md motion-safe:active:scale-[0.97]"
              >
                Demander une demo
                <ArrowRight className="h-4 w-4 transition-transform duration-200 ease-[var(--ease-out-landing)] motion-safe:group-hover:translate-x-0.5" />
              </a>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white/70 px-5 py-3 text-sm font-semibold text-slate-700 transition-[background-color,color,border-color,transform] duration-200 ease-[var(--ease-out-landing)] hover:bg-white hover:text-slate-950 hover:border-slate-400 motion-safe:active:scale-[0.97]"
              >
                Acceder a l&apos;app
              </Link>
            </div>
          </div>

          <HeroCardTilt className="landing-fadeup" >
            <div
              className="border border-slate-300 bg-[#fbfcfc] shadow-2xl shadow-slate-400/20"
              style={{ animationDelay: '120ms' } as React.CSSProperties}
            >
              <div className="border-b border-slate-200 px-5 py-4">
                <div className="flex items-center justify-between gap-4 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  <span>Brief de passation</span>
                  <span className="inline-flex items-center gap-1.5 text-emerald-700">
                    <span className="landing-pulse-soft inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Memoire prete a transmettre
                  </span>
                </div>
              </div>
              <div className="p-5 md:p-7">
                <div className="flex items-start justify-between gap-5 border-b border-slate-200 pb-5">
                  <div>
                    <p className="text-xl font-semibold text-slate-950">
                      Medipole - Blocs operatoires
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      Equipe sortante : Noumea Centre
                    </p>
                  </div>
                  <div className="shrink-0 border border-slate-300 bg-slate-50 px-3 py-2 text-right">
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">
                      Releve
                    </p>
                    <p className="text-sm font-semibold text-slate-900">
                      Releve prevue dans 18 jours
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid gap-3">
                  {[
                    {
                      label: 'Acces',
                      text: 'Badge au PC securite, niveau -1, vestiaire dedie.',
                      icon: KeyRound,
                    },
                    {
                      label: 'A savoir',
                      text: 'Zone a acces reglemente. Intervention avant ouverture.',
                      icon: FileText,
                    },
                    {
                      label: 'Anomalie recente',
                      text: 'Porte coupe-feu signalee bloquee, local technique.',
                      icon: AlertTriangle,
                    },
                    {
                      label: 'Preuves disponibles',
                      text: 'Photos de passage et rapport mensuel exportables.',
                      icon: ShieldCheck,
                    },
                  ].map((item, i) => {
                    const Icon = item.icon
                    return (
                      <div
                        key={item.label}
                        className="landing-fadeup grid grid-cols-[2.25rem_1fr] gap-3 border border-slate-200 bg-white/80 p-3 transition-colors duration-200 hover:bg-white"
                        style={{ animationDelay: `${260 + i * 70}ms` }}
                      >
                        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-100 text-slate-600">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                            {item.label}
                          </p>
                          <p className="mt-1 text-sm leading-6 text-slate-700">{item.text}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </HeroCardTilt>
        </section>

        <section className="border-y border-slate-200 bg-[#f8fafb] py-16">
          <div className="mx-auto max-w-6xl px-5">
            <div className="landing-reveal max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Fragilite invisible
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                Quand le savoir part
              </h2>
            </div>
            <div className="mt-8 grid gap-5 md:grid-cols-3">
              {fragileMoments.map((moment, index) => (
                <div
                  key={moment}
                  className="landing-reveal border border-slate-200 bg-white/80 p-5 text-slate-700 transition-[transform,border-color,box-shadow] duration-200 ease-[var(--ease-out-landing)] hover:border-slate-300 hover:shadow-md motion-safe:hover:-translate-y-0.5"
                  style={{ animationDelay: `${index * 70}ms` }}
                >
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                    Situation 0{index + 1}
                  </span>
                  <p className="mt-4 text-base leading-7">{moment}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-16">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
            <div className="landing-reveal">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Registre de memoire
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                Ce que MemorIA garde
              </h2>
              <p className="mt-5 text-base leading-7 text-slate-600">
                La memoire ne se limite pas a une note. Elle relie les traces
                operationnelles qui permettent de reprendre un site, documenter un
                passage ou retrouver une reference utile.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {memoryItems.map((item, i) => {
                const Icon = item.icon
                return (
                  <div
                    key={item.label}
                    className="landing-reveal group border border-slate-200 bg-white/80 p-4 transition-[background-color,border-color,transform,box-shadow] duration-200 ease-[var(--ease-out-landing)] hover:bg-white hover:border-slate-300 hover:shadow-md motion-safe:hover:-translate-y-0.5"
                    style={{ animationDelay: `${i * 60}ms` }}
                  >
                    <div className="mb-5 flex h-9 w-9 items-center justify-center rounded-md bg-slate-100 text-slate-600 transition-[background-color,transform] duration-200 ease-[var(--ease-out-landing)] group-hover:bg-slate-200 motion-safe:group-hover:scale-110">
                      <Icon className="h-4 w-4" />
                    </div>
                    <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-950">
                      {item.label}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{item.text}</p>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        <section className="bg-[#dfe5e9] py-16">
          <div className="mx-auto max-w-5xl px-5">
            <div className="landing-reveal max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">
                Apparition utile
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                Ce que MemorIA fait remonter
              </h2>
              <p className="mt-5 text-base leading-7 text-slate-700">
                Ce que les equipes vivent se transforme en signaux exploitables :
                un probleme relie, une releve a preparer, une preuve reutilisable.
              </p>
            </div>

            <div className="mt-8 divide-y divide-slate-200 border border-slate-300 bg-[#fbfcfc]">
              {surfacedSignals.map((item, i) => {
                const Icon = item.icon
                return (
                  <div
                    key={item.title}
                    className="landing-reveal group grid gap-4 p-5 transition-colors duration-200 hover:bg-white md:grid-cols-[13rem_1fr] md:p-6"
                    style={{ animationDelay: `${i * 90}ms` }}
                  >
                    <div>
                      <div
                        className={`inline-flex items-center gap-2 border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] transition-transform duration-200 ease-[var(--ease-out-landing)] motion-safe:group-hover:scale-[1.04] ${item.tone}`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {item.signal}
                      </div>
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-slate-950">{item.title}</h3>
                      <p className="mt-2 text-sm leading-7 text-slate-600">{item.text}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-16">
          <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
            <div className="landing-reveal">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Valeur direction
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                Ce que la direction gagne
              </h2>
              <p className="mt-5 text-base leading-7 text-slate-600">
                Moins de dependance aux personnes, plus de continuite entre les
                equipes, et des preuves disponibles quand une decision doit etre
                prise vite.
              </p>
            </div>
            <div className="grid gap-5 md:grid-cols-3">
              {gains.map((gain, i) => {
                const Icon = gain.icon
                return (
                  <div
                    key={gain.title}
                    className="landing-reveal group border border-slate-200 bg-white/80 p-5 transition-[transform,border-color,box-shadow] duration-200 ease-[var(--ease-out-landing)] hover:border-slate-300 hover:shadow-lg motion-safe:hover:-translate-y-1"
                    style={{ animationDelay: `${i * 80}ms` }}
                  >
                    <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-md bg-slate-950 text-white transition-transform duration-200 ease-[var(--ease-out-landing)] motion-safe:group-hover:scale-110 motion-safe:group-hover:-rotate-3">
                      <Icon className="h-4 w-4" />
                    </div>
                    <h3 className="text-base font-semibold text-slate-950">{gain.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-slate-600">{gain.text}</p>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        <section className="border-y border-slate-200 bg-[#f8fafb] py-14">
          <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 md:flex-row md:items-center md:justify-between">
            <div className="landing-reveal max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                MemorIA
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
                Voir comment votre memoire operationnelle peut survivre aux passations.
              </h2>
            </div>
            <a
              href={demoHref}
              className="landing-reveal group inline-flex w-fit items-center gap-2 rounded-lg bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition-[background-color,transform,box-shadow] duration-200 ease-[var(--ease-out-landing)] hover:bg-slate-800 hover:shadow-md motion-safe:active:scale-[0.97]"
            >
              Demander une demo
              <ArrowRight className="h-4 w-4 transition-transform duration-200 ease-[var(--ease-out-landing)] motion-safe:group-hover:translate-x-0.5" />
            </a>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-[#eef1f3] py-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 text-xs text-slate-500">
          <span>© {new Date().getFullYear()} MemorIA</span>
          <Link
            href="/login"
            className="group inline-flex items-center gap-1 transition-colors duration-200 hover:text-slate-950"
          >
            Se connecter
            <ArrowRight className="h-3 w-3 transition-transform duration-200 ease-[var(--ease-out-landing)] motion-safe:group-hover:translate-x-0.5" />
          </Link>
        </div>
      </footer>
    </div>
  )
}
