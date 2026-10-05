import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-api-bot-controller',
  ['lib/types/index.js'],
  { hostPhase: true },
)
