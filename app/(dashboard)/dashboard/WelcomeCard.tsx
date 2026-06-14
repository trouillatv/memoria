import Link from 'next/link'
import {
  Upload,
  ListChecks,
  FileCheck,
  ClipboardList,
  ArrowRight,
  CheckCircle2,
  Circle,
  type LucideIcon,
} from 'lucide-react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { OnboardingProgress } from '@/lib/db/onboarding'

interface StepDef {
  key: keyof Omit<OnboardingProgress, 'allDone'>
  number: number
  icon: LucideIcon
  title: string
  description: string
  href: string
  cta: string
}

const STEPS: StepDef[] = [
  {
    key: 'hasImportedTender',
    number: 1,
    icon: Upload,
    title: 'Importer un dossier de démarrage',
    description:
      'Déposez votre premier dossier. Le copilote en extraira les engagements et rédigera la mémoire technique.',
    href: '/tenders',
    cta: 'Aller aux dossiers',
  },
  {
    key: 'hasCuratedEngagement',
    number: 2,
    icon: ListChecks,
    title: 'Valider les promesses',
    description:
      "Relisez et validez les engagements extraits par l'IA. Vous gardez la main sur ce qui vous engage.",
    href: '/tenders',
    cta: 'Voir les dossiers',
  },
  {
    key: 'hasActiveContract',
    number: 3,
    icon: FileCheck,
    title: 'Convertir en contrat actif',
    description:
      "Une fois le dossier gagné, convertissez-le en contrat opérationnel. Les engagements deviennent vos promesses à tenir.",
    href: '/tenders',
    cta: 'Voir les dossiers',
  },
  {
    key: 'hasMission',
    number: 4,
    icon: ClipboardList,
    title: 'Créer missions et récurrences',
    description:
      "Ajoutez les sites, les missions à exécuter, et leurs récurrences. La preuve commence à s'accumuler.",
    href: '/contracts',
    cta: 'Voir les contrats',
  },
]

export function WelcomeCard({ progress }: { progress: OnboardingProgress }) {
  // Premier index non franchi — c'est lui qu'on met en avant (CTA visible).
  const nextStepIndex = STEPS.findIndex((s) => !progress[s.key])
  const completedCount = STEPS.filter((s) => progress[s.key]).length

  return (
    <Card data-slot="welcome-card">
      <CardHeader>
        <CardTitle className="text-lg">Démarrer avec MemorIA</CardTitle>
        <CardDescription>
          {completedCount === 0
            ? 'Quatre étapes pour transformer un dossier en preuves accumulées.'
            : `${completedCount} / ${STEPS.length} étapes franchies. Plus que ${STEPS.length - completedCount} pour activer la boucle de preuve.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3">
          {STEPS.map((step, idx) => {
            const done = progress[step.key]
            const isNext = idx === nextStepIndex
            const Icon = step.icon

            return (
              <li
                key={step.key}
                data-step={step.key}
                data-state={done ? 'done' : isNext ? 'next' : 'future'}
                className={`flex items-start gap-3 rounded-md p-3 transition-colors ${
                  done
                    ? 'bg-emerald-50/40'
                    : isNext
                    ? 'bg-card border border-border'
                    : 'bg-muted/20'
                }`}
              >
                <div className="shrink-0 mt-0.5">
                  {done ? (
                    <CheckCircle2
                      className="h-5 w-5 text-emerald-600"
                      strokeWidth={2}
                      data-testid={`step-${step.number}-done`}
                    />
                  ) : (
                    <Circle
                      className={`h-5 w-5 ${
                        isNext ? 'text-foreground' : 'text-muted-foreground/50'
                      }`}
                      strokeWidth={isNext ? 2 : 1.5}
                      data-testid={`step-${step.number}-${isNext ? 'next' : 'future'}`}
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <Icon
                      className={`h-3.5 w-3.5 ${
                        done
                          ? 'text-emerald-700'
                          : isNext
                          ? 'text-foreground'
                          : 'text-muted-foreground'
                      }`}
                    />
                    <span
                      className={`text-sm font-medium ${
                        done
                          ? 'text-emerald-900'
                          : isNext
                          ? 'text-foreground'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {step.title}
                    </span>
                  </div>
                  <p
                    className={`text-xs ${
                      done ? 'text-emerald-800/70' : 'text-muted-foreground'
                    }`}
                  >
                    {step.description}
                  </p>
                </div>
                {!done && isNext && (
                  <Link
                    href={step.href}
                    className={cn(
                      buttonVariants({ variant: 'outline', size: 'sm' }),
                      'shrink-0 self-center'
                    )}
                  >
                    {step.cta}
                    <ArrowRight className="h-3.5 w-3.5 ml-1" />
                  </Link>
                )}
              </li>
            )
          })}
        </ol>
      </CardContent>
    </Card>
  )
}
