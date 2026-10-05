/**
 * Small shared helpers for the Bot package's model-facing tools: one string
 * bound and the compact JSON output shape every Bot tool answers with.
 * @module @deepseek-ai/dsh-bot/src/tool-shared
 */

import type { InferValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'

/**
 * Cut one string to the bound, marking the cut with an ellipsis.
 * @param text - Text to bound.
 * @param max - Longest accepted length, ellipsis included.
 * @returns the text unchanged when it fits, else a bounded prefix with `…`.
 */
export function bound(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1))}…`
}

/**
 * Declare a tool output schema with compact model-facing JSON rendering.
 * @param schema - The tool's value schema.
 * @returns the output pair expected by `defineTool`.
 */
export function jsonOutput<const S extends ValueSchemaSpec>(schema: S): {
  schema: S
  render: (args: unknown, value: InferValue<S>) => [{ type: 'text'; text: string }]
} {
  return {
    schema,
    render: (_args: unknown, value: InferValue<S>) => [{ type: 'text', text: JSON.stringify(value) }],
  }
}
