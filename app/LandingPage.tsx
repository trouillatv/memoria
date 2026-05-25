import Link from 'next/link'
import {
  Shield, ClipboardList, Camera, FileText, Users, TrendingUp,
  CheckCircle2, ArrowRight, Building2, HardHat, Briefcase,
  AlertTriangle, Clock, Layers, Sparkles,
} from 'lucide-react'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-gray-900">

      {/* HEADER */}
      <header className="sticky top-0 z-50 border-b border-gray-100 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="MemorIA" className="h-8 w-8 rounded-lg object-cover ring-1 ring-black/5" />
            <span className="text-lg font-semibold tracking-tight">MemorIA</span>
          </div>
          <Link
            href="/login"
            className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors"
          >
            Se connecter <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </header>

      {/* HERO */}
      <section className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <div className="grid gap-12 md:grid-cols-2 md:items-center">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-brand-100 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
              Entreprises de nettoyage · Nouvelle-Calédonie
            </div>
            <h1 className="text-4xl font-bold leading-tight tracking-tight text-gray-900 md:text-5xl">
              Vos équipes passent.<br />
              <span className="text-brand-600">Les traces restent.</span><br />
              Faites-en un capital.
            </h1>
            <p className="text-lg text-gray-500 leading-relaxed">
              MemorIA documente chaque intervention, relie ce que les équipes oublient,
              et transforme vos passages terrain en preuves irréfutables.
            </p>
            <div className="flex flex-wrap gap-3">
              <a
                href="mailto:trouillatv@gmail.com?subject=Demande%20de%20d%C3%A9mo%20MemorIA"
                className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-700 active:scale-95"
              >
                Demander une démo
              </a>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 transition-all hover:bg-gray-50 active:scale-95"
              >
                Accéder à l'app
              </Link>
            </div>
          </div>

          {/* Fausse card d'intervention */}
          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-lg shadow-gray-100/80">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">Aujourd'hui</span>
              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">3 passages effectués</span>
            </div>
            {[
              { site: 'Tour Pentecost · RDC', agent: 'M. Kalosil', photos: 4, status: 'done' },
              { site: 'Résidence Baie des Citrons · Entrée', agent: 'M. Wejieme', photos: 2, status: 'done' },
              { site: 'Centre Commercial Foch · Allée A', agent: 'Mme. Tein', photos: 0, status: 'progress' },
            ].map((item) => (
              <div key={item.site} className="mb-3 flex items-center gap-3 rounded-xl border border-gray-100 p-3">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${item.status === 'done' ? 'bg-emerald-50' : 'bg-amber-50'}`}>
                  {item.status === 'done'
                    ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    : <ClipboardList className="h-4 w-4 text-amber-600" />
                  }
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">{item.site}</p>
                  <p className="text-xs text-gray-400">{item.agent}</p>
                </div>
                {item.photos > 0 && (
                  <div className="flex items-center gap-1 text-xs text-gray-400">
                    <Camera className="h-3.5 w-3.5" />
                    {item.photos}
                  </div>
                )}
              </div>
            ))}
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-brand-100 bg-brand-50 p-3">
              <FileText className="h-4 w-4 shrink-0 text-brand-600" />
              <p className="text-xs text-brand-700 font-medium">Rapport mensuel généré · Prêt à envoyer au client</p>
            </div>
          </div>
        </div>
      </section>

      {/* AVANT / APRÈS */}
      <section className="bg-gray-50 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="mb-10 text-center text-2xl font-bold text-gray-900">Le changement concret</h2>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-red-100 bg-white p-6">
              <span className="mb-4 inline-block rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-red-600 uppercase tracking-wider">Avant</span>
              <ul className="space-y-3 text-sm text-gray-600">
                {[
                  'Fiches papier perdues, photos éparpillées sur WhatsApp',
                  'Litige client → impossible de prouver que l\'équipe est passée',
                  'Appel d\'offres perdu faute de références documentées',
                  'Chef d\'équipe sans visibilité sur l\'avancement en temps réel',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="mt-0.5 text-red-400">✕</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-emerald-100 bg-white p-6">
              <span className="mb-4 inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-600 uppercase tracking-wider">Avec MemorIA</span>
              <ul className="space-y-3 text-sm text-gray-600">
                {[
                  'Chaque passage documenté : photos horodatées, signature, commentaires',
                  'Dossier de preuves exportable en PDF en 30 secondes',
                  'Les signaux faibles reliés entre eux — un problème récurrent détecté avant que le client ne se plaigne',
                  'Tableau de bord temps réel — qui est où, quoi, quand',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* POUR QUI */}
      <section className="py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="mb-3 text-center text-2xl font-bold text-gray-900">Fait pour toute votre entreprise</h2>
          <p className="mb-12 text-center text-gray-500">Un seul outil, trois regards sur votre activité.</p>
          <div className="grid gap-6 md:grid-cols-3">
            {[
              {
                icon: <Briefcase className="h-6 w-6 text-brand-600" />,
                title: 'Dirigeant',
                desc: 'Prouvez la qualité de vos prestations à vos clients, remportez des appels d\'offres grâce à vos références documentées, et pilotez l\'activité depuis un tableau de bord clair.',
              },
              {
                icon: <Users className="h-6 w-6 text-brand-600" />,
                title: 'Responsable d\'exploitation',
                desc: 'Planifiez les interventions, affectez vos équipes, suivez l\'avancement en temps réel et générez les rapports mensuels sans ressaisie manuelle.',
              },
              {
                icon: <HardHat className="h-6 w-6 text-brand-600" />,
                title: 'Agent terrain',
                desc: 'Retrouvez votre planning, documentez chaque passage avec votre téléphone et signalez les anomalies — sans formation, en quelques secondes.',
              },
            ].map((p) => (
              <div key={p.title} className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50">
                  {p.icon}
                </div>
                <h3 className="mb-2 font-semibold text-gray-900">{p.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* COMMENT ÇA MARCHE */}
      <section className="bg-gray-50 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="mb-3 text-center text-2xl font-bold text-gray-900">Comment ça marche</h2>
          <p className="mb-12 text-center text-gray-500">Opérationnel en une journée.</p>
          <div className="grid gap-6 md:grid-cols-3">
            {[
              { n: '1', icon: <ClipboardList className="h-6 w-6 text-brand-600" />, title: 'Planifiez', desc: 'Créez vos sites, vos missions et affectez les équipes. L\'app terrain est prête immédiatement.' },
              { n: '2', icon: <Camera className="h-6 w-6 text-brand-600" />, title: 'Documentez', desc: 'Vos agents photographient, notent et signent depuis leur téléphone. Tout est horodaté et géolocalisé.' },
              { n: '3', icon: <FileText className="h-6 w-6 text-brand-600" />, title: 'Prouvez', desc: 'Générez en un clic les rapports mensuels et dossiers de preuves prêts à envoyer à vos clients.' },
            ].map((step) => (
              <div key={step.n} className="relative rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                <div className="mb-4 flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">{step.n}</span>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50">{step.icon}</div>
                </div>
                <h3 className="mb-2 font-semibold text-gray-900">{step.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CE QUE MEMORIA RÉVÈLE */}
      <section className="py-20">
        <div className="mx-auto max-w-4xl px-6">
          <div className="mb-10 text-center">
            <h2 className="text-2xl font-bold text-gray-900">Ce que MemorIA révèle</h2>
            <p className="mt-3 text-gray-500">Ce que vos équipes vivent mais n'arrivent pas à formuler.</p>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white shadow-sm divide-y divide-gray-100">

            <div className="flex items-start gap-4 p-6">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="font-semibold text-gray-900 mb-1">Bloc B · Tour Pentecost</p>
                <p className="text-sm text-gray-500 leading-relaxed">
                  Problème de robinet signalé en <span className="font-medium text-gray-900">octobre</span>,
                  fuite d'eau notée en <span className="font-medium text-gray-900">janvier</span>,
                  moisissure photographiée en <span className="font-medium text-gray-900">mars</span>.
                  Trois signalements distincts.{' '}
                  <span className="font-semibold text-amber-600">Un seul problème non traité.</span>
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4 p-6">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50">
                <Clock className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <p className="font-semibold text-gray-900 mb-1">Entrée nord · Résidence Baie des Citrons</p>
                <p className="text-sm text-gray-500 leading-relaxed">
                  Absente du planning depuis <span className="font-medium text-gray-900">11 semaines</span>.
                  Aucune alerte envoyée. Le client n'a pas encore réclamé.{' '}
                  <span className="font-semibold text-red-600">Il va le faire.</span>
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4 p-6">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50">
                <Layers className="h-5 w-5 text-brand-600" />
              </div>
              <div>
                <p className="font-semibold text-gray-900 mb-1">Appel d'offres · Mairie de Nouméa</p>
                <p className="text-sm text-gray-500 leading-relaxed">
                  Critère "traçabilité des passages" demandé.{' '}
                  <span className="font-medium text-gray-900">47 interventions documentées</span> sur des sites comparables
                  dans votre historique.{' '}
                  <span className="font-semibold text-brand-600">Dossier de références prêt en 1 clic.</span>
                </p>
              </div>
            </div>
          </div>

          <p className="mt-5 text-center text-xs text-gray-400">
            Pas un chatbot. Pas un dashboard de plus. Une mémoire qui relie ce que les équipes oublient.
          </p>
        </div>
      </section>

      {/* BÉNÉFICES */}
      <section className="bg-gray-50 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="mb-12 text-center text-2xl font-bold text-gray-900">Ce que vous y gagnez</h2>
          <div className="grid gap-6 md:grid-cols-3">
            {[
              { icon: <Shield className="h-6 w-6 text-brand-600" />, title: 'Zéro litige sans réponse', desc: 'Chaque passage est prouvé. Fini les contestations client sans fondement : le dossier est prêt en 30 secondes.' },
              { icon: <TrendingUp className="h-6 w-6 text-brand-600" />, title: 'Appels d\'offres gagnés', desc: 'Vos références sont documentées, datées et exportables. Vos candidatures deviennent concrètes.' },
              { icon: <Building2 className="h-6 w-6 text-brand-600" />, title: 'Équipes autonomes', desc: 'Agents, chefs d\'équipe, managers — chacun voit exactement ce qu\'il a besoin de voir, sans surcharge.' },
            ].map((b) => (
              <div key={b.title} className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50">{b.icon}</div>
                <h3 className="mb-2 font-semibold text-gray-900">{b.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{b.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA FINAL */}
      <section className="bg-brand-600 py-20">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="mb-4 text-3xl font-bold text-white">Prêt à transformer vos interventions en capital ?</h2>
          <p className="mb-8 text-brand-100">Sans engagement · Sans carte bancaire · Déploiement en 1 jour</p>
          <a
            href="mailto:trouillatv@gmail.com?subject=Demande%20de%20d%C3%A9mo%20MemorIA"
            className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-brand-600 shadow-sm transition-all hover:bg-brand-50 active:scale-95"
          >
            Demander une démo <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-gray-100 py-8">
        <div className="mx-auto max-w-6xl px-6 flex items-center justify-between text-xs text-gray-400">
          <span>© {new Date().getFullYear()} MemorIA</span>
          <Link href="/login" className="hover:text-gray-600 transition-colors">Se connecter</Link>
        </div>
      </footer>

    </div>
  )
}
