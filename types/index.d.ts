/** A clarifying question the improver asked and the person's answer. */
export type QA = { question: string; answer: string }

/** Where the improver is in its flow; drawn by the band above the prompt. */
export type Phase =
  | { kind: 'idle' }
  | { kind: 'working'; label: string; run: number }
  | {
      kind: 'questions'
      original: string
      questions: string[]
      answers: string[]
    }
  | {
      kind: 'preview'
      original: string
      improved: string
      changes: string
      qa: QA[]
    }
  | { kind: 'error'; message: string; original: string }

declare module 'claude-code' {
  interface PluginState {
    'prompt-improver': { phase: Phase; hasDraft: boolean }
  }
}
