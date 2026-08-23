// GATE DE LIVRAISON — typecheck de l'arbre COMMITÉ, pas du working tree.
//
// Pourquoi ce script existe (incident du 2026-08-23) :
//   `a84f52b4` a été poussé sans `lib/visits/debrief-analysis.ts`, resté dans le
//   working tree. `npx tsc --noEmit` passait — il lisait le disque, où le fichier
//   était présent. Le build Vercel, lui, ne voyait que le commit : `main` a cessé
//   de compiler, et trois lots dont un déjà validé sont restés invisibles en
//   production pendant des heures sans qu'aucun signal ne le dise.
//
// Un `git status` propre n'est PAS une preuve équivalente : il dit ce qui reste
// à commiter, pas si ce qui est commité se tient tout seul. La seule preuve est
// de matérialiser le SHA exact ailleurs et de le typechecker là.
//
// Le worktree est créé en HEAD détaché et détruit à la fin : aucune branche créée,
// aucun index partagé, conforme à la règle « une seule branche ».
//
//   node scripts/verify-pushable.mjs [ref]      (défaut : HEAD)

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, copyFileSync, symlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const ref = process.argv[2] ?? 'HEAD'
const repo = process.cwd()

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

const sha = git('rev-parse', ref)
const worktree = join(tmpdir(), `memoria-verify-${sha.slice(0, 12)}`)

/**
 * Artefacts NON versionnés dont le typecheck a besoin sans qu'ils soient du code
 * source. Les rattacher ne masque rien : ce que le gate cherche, ce sont les
 * fichiers source absents du commit.
 *   - node_modules  : dépendances installées
 *   - next-env.d.ts : généré par Next, gitignoré, référencé par tsconfig
 *   - .next         : types de routes générés, référencés par tsconfig
 */
function attachGeneratedArtifacts() {
  for (const dir of ['node_modules', '.next']) {
    const src = join(repo, dir)
    if (!existsSync(src)) continue
    // Sous Windows, une jonction ne demande pas de privilège élevé, contrairement
    // à un lien symbolique de répertoire.
    if (process.platform === 'win32') {
      execFileSync('cmd', ['/c', 'mklink', '/J', join(worktree, dir), src], { stdio: 'ignore' })
    } else {
      symlinkSync(src, join(worktree, dir), 'dir')
    }
  }
  const nextEnv = join(repo, 'next-env.d.ts')
  if (existsSync(nextEnv)) copyFileSync(nextEnv, join(worktree, 'next-env.d.ts'))
}

function cleanup() {
  try {
    execFileSync('git', ['worktree', 'remove', '--force', worktree], { stdio: 'ignore' })
  } catch {
    // Le worktree a pu ne jamais être créé, ou être déjà retiré.
  }
  try {
    rmSync(worktree, { recursive: true, force: true })
  } catch {
    // Rien à nettoyer.
  }
  try {
    execFileSync('git', ['worktree', 'prune'], { stdio: 'ignore' })
  } catch {
    // Sans conséquence : `prune` est un simple entretien.
  }
}

console.log(`Gate de livraison — typecheck de l'arbre commité ${sha.slice(0, 8)} (${ref})`)
console.log(`  worktree détaché : ${worktree}`)

cleanup() // au cas où un run précédent aurait été interrompu

let code = 1
try {
  execFileSync('git', ['worktree', 'add', '--detach', worktree, sha], { stdio: 'ignore' })
  attachGeneratedArtifacts()

  const tsc = spawnSync(
    process.execPath,
    ['--max-old-space-size=8192', join('node_modules', 'typescript', 'bin', 'tsc'), '--noEmit'],
    { cwd: worktree, encoding: 'utf8' },
  )
  const output = `${tsc.stdout ?? ''}${tsc.stderr ?? ''}`.trim()
  code = tsc.status ?? 1

  if (code === 0) {
    console.log(`\nOK — ${sha.slice(0, 8)} compile seul. Poussable.`)
  } else {
    console.error(`\nÉCHEC — ${sha.slice(0, 8)} ne compile PAS seul.`)
    console.error("Cause la plus probable : un fichier nécessaire est resté dans le working tree.")
    console.error(`\n${output}`)
  }
} catch (e) {
  console.error(`\nGATE NON CONCLUANT : ${e instanceof Error ? e.message : String(e)}`)
  console.error('Un gate non exécuté ne vaut pas un gate réussi — ne pas pousser sur cette base.')
  code = 1
} finally {
  cleanup()
}

process.exit(code)
