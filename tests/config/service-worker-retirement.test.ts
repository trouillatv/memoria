import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

describe('retired service worker', () => {
  test('does not intercept fetches and unregisters stale registrations', () => {
    const source = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8')

    expect(source).not.toMatch(/addEventListener\(\s*['"]fetch['"]/)
    expect(source).not.toContain('respondWith')
    expect(source).toContain('self.registration.unregister')
    expect(source).toContain('clients.claim')
  })
})
