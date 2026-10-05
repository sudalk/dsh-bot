/** The Bot profile bundle inserts the four Bot rows the shipped Web composition leaves out. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

const root = fileURLToPath(new URL('..', import.meta.url))

interface Manifest {
  name?: string
  icon?: string
  private?: boolean
  publishConfig?: { access?: string }
  exports?: Record<string, unknown>
  dependencies?: Record<string, string>
  dsh?: { bundle?: { patch?: string } }
}

describe('Bot profile bundle', () => {
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as Manifest

  it('publishes as a bundle with plugin-manager display metadata', () => {
    expect(manifest.name).toBe('@deepseek-ai/dsh-bot-profile')
    expect(manifest.private).toBeUndefined()
    expect(manifest.publishConfig?.access).toBe('public')
    expect(manifest.icon).toBe('./icon.svg')
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.exports?.['./locale/*.json']).toBe('./locale/*.json')
    expect(manifest.exports?.['./cordis.patch.yml']).toBe('./cordis.patch.yml')
    // Each inserted row names a package the bundle depends on, so the rows resolve from the bundle.
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      '@deepseek-ai/dsh-api-bot-controller', '@deepseek-ai/dsh-bot', '@deepseek-ai/dsh-bot-room',
      '@deepseek-ai/dsh-client-ui-bot',
    ])
  })

  it('inserts the four Bot rows switched on', () => {
    const parsed = yaml.load(readFileSync(resolve(root, './cordis.patch.yml'), 'utf8'), { schema: entryListSchema })
    expect(parsed).toEqual([{ insert: [
      { id: 'bot', name: '@deepseek-ai/dsh-bot' },
      { id: 'bot-room', name: '@deepseek-ai/dsh-bot-room' },
      { id: 'bot-controller', name: '@deepseek-ai/dsh-api-bot-controller' },
      { id: 'ui-bot', name: '@deepseek-ai/dsh-client-ui-bot' },
    ] }])
  })
})
