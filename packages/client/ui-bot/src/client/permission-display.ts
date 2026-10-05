/**
 * Display labels for a Bot's pinned permission preset. The product's own
 * wording covers the presets it ships; any other advertised preset keeps the
 * deployment's catalog label, and an unadvertised one shows its raw value so a
 * stale pin stays visible instead of rendering blank.
 */

import type { PresetOption } from '@deepseek-ai/dsh-permission-presets/client'

/** Dictionary keys for the built-in permission presets. */
export type PermissionLabelKey =
  | 'permissionReadOnly'
  | 'permissionWorkspaceWrite'
  | 'permissionFullAccess'

const BUILT_IN_PRESETS = new Map<string, PermissionLabelKey>([
  ['read-only', 'permissionReadOnly'],
  ['workspace-write', 'permissionWorkspaceWrite'],
  ['danger-full-access', 'permissionFullAccess'],
])

/**
 * Label one pinned permission preset.
 * @param value - the preset value recorded on the Bot.
 * @param catalog - presets the Host advertises, or `undefined` before they load.
 * @param t - dictionary lookup for the built-in labels.
 * @returns the label to show.
 */
export function permissionLabel(
  value: string,
  catalog: readonly PresetOption[] | undefined,
  t: (key: PermissionLabelKey) => string,
): string {
  const builtIn = BUILT_IN_PRESETS.get(value)
  if (builtIn !== undefined) return t(builtIn)
  return catalog?.find(option => option.value === value)?.name ?? value
}
