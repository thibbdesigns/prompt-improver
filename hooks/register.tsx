import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Phase, QA } from '../types'
import { buildPrompt, parseReply } from './instructions'

// Every rewrite runs on Opus 5.5 at medium effort, whatever model and effort
// the session itself uses, so a session on a pricier model doesn't spend it here.
const MODEL = 'claude-opus-5-5'
const EFFORT = 'medium'

// How much of the conversation (newest last) goes along with the draft.
const CONTEXT_CHARS = 60_000
const TOOL_INPUT_CHARS = 300

const IDLE: Phase = { kind: 'idle' }
const phase = atom({ plugin: 'prompt-improver', key: 'phase' } as const, IDLE, {
  shape: 'phase-1',
})

// Bumped on every start and cancel, so a stale reply is ignored.
let run = 0

function setPhase($: EngineInterface, next: Phase) {
  return update($, phase, () => next)
}

/** The session so far as plain text, trimmed to its newest part; null if empty. */
async function conversationText($: EngineInterface): Promise<string | null> {
  const messages = await $.session.messages()
  const lines: string[] = []
  for (const m of messages) {
    const who = m.role === 'user' ? 'User' : 'Claude'
    if (m.text.trim()) {
      lines.push(`${who}: ${m.text.trim()}`)
    }
    for (const use of m.toolUses) {
      const input = JSON.stringify(use.input)
      lines.push(
        `[Claude used ${use.tool}: ${input.length > TOOL_INPUT_CHARS ? `${input.slice(0, TOOL_INPUT_CHARS)}…` : input}]`,
      )
    }
  }
  const text = lines.join('\n\n')
  if (!text) {
    return null
  }
  return text.length > CONTEXT_CHARS ? `…${text.slice(-CONTEXT_CHARS)}` : text
}

/** Asks the model; `qa` null allows clarifying questions. */
async function improve(
  $: EngineInterface,
  original: string,
  qa: QA[] | null,
) {
  const mine = ++run
  await setPhase($, {
    kind: 'working',
    label: qa === null ? 'Improving your prompt…' : 'Writing the improved prompt…',
    run: mine,
  })

  const conversation = await conversationText($)
  const reply = await $.model.complete({
    model: MODEL,
    effort: EFFORT,
    prompt: buildPrompt(original, qa, conversation),
    maxTokens: 8000,
  })

  if (mine !== run) {
    return // cancelled or superseded
  }

  if (!reply.isAnswered) {
    const why =
      reply.reason === 'api-error'
        ? `the API returned an error${'status' in reply && reply.status ? ` (${reply.status})` : ''}`
        : reply.reason === 'empty-reply'
          ? 'the model sent back an empty reply'
          : 'the request was cut short'
    await setPhase($, {
      kind: 'error',
      message: `Couldn't improve the prompt: ${why}.`,
      original,
    })
    return
  }

  const parsed = parseReply(reply.text)
  if (parsed.kind === 'questions' && qa === null) {
    await setPhase($, {
      kind: 'questions',
      original,
      questions: parsed.questions,
      answers: parsed.questions.map(() => ''),
    })
    return
  }

  const improved =
    parsed.kind === 'improved' ? parsed.improved : reply.text.trim()
  await setPhase($, {
    kind: 'preview',
    original,
    improved,
    changes: parsed.kind === 'improved' ? parsed.changes : '',
    qa: qa ?? [],
  })
}

async function start($: EngineInterface) {
  const { text } = await $.prompt.read()
  if (text.trim().length === 0) {
    $.ui.toast('Type a prompt first, then press Improve.')
    return
  }
  await improve($, text, null)
}

async function cancel($: EngineInterface) {
  run += 1
  await setPhase($, IDLE)
}

async function accept($: EngineInterface, improved: string, surface: string) {
  const filled = await $.prompt.fill({ text: improved, mode: 'replace' })
  if (!filled.isFilled) {
    const copied = await $.ui.copy({ text: improved, surface })
    $.ui.toast(
      copied.isCopied
        ? "Couldn't write to the prompt box, so the improved prompt was copied to your clipboard."
        : "Couldn't write to the prompt box or the clipboard.",
    )
  }
  await setPhase($, IDLE)
}

// A model call takes longer than a press handler's 10s budget, so presses
// start the work and return at once; the band shows progress meanwhile.
function inBackground($: EngineInterface, work: Promise<void>) {
  void work.catch((error: unknown) =>
    setPhase($, {
      kind: 'error',
      message: `Couldn't improve the prompt: ${error instanceof Error ? error.message : String(error)}`,
      original: '',
    }),
  )
}

export const register: Register = on => {
  // Sending a prompt ends any improvement in progress.
  on('prompt.submit', ($, e, next) => {
    run += 1
    void read($, phase)
      .then(current => (current.kind === 'idle' ? undefined : setPhase($, IDLE)))
      .catch(() => undefined)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // What other mods draw in the band, kept beside ours so their buttons
    // stay on screen too.
    const rest = await next(e)
    if (e.props.hasSurvey) {
      return rest
    }

    const current = await read($, phase)
    const { Box, Button, Text, Input } = $.ui.resolve(e)

    const mine = (() => {
      switch (current.kind) {
        case 'idle':
          // Always shown; pressing it with an empty box shows a hint.
          return (
            <Box flexDirection="row" gap={1}>
              <Button
                key="improve"
                label="✨ Improve prompt"
                onPress={() => inBackground($, start($))}
              />
            </Box>
          )

        case 'working':
          return (
            <Box flexDirection="row" gap={1}>
              <Text dimColor>{current.label}</Text>
              <Button key="cancel" label="Cancel" onPress={() => cancel($)} />
            </Box>
          )

        case 'questions': {
          const proceed = () =>
            improve(
              $,
              current.original,
              current.questions.map((question, i) => ({
                question,
                answer: current.answers[i] ?? '',
              })),
            )
          return (
            <Box flexDirection="column" gap={1}>
              <Text bold>A few quick questions to sharpen your prompt</Text>
              {current.questions.map((question, i) => (
                <Box key={`q${i}`} flexDirection="column">
                  <Text>{`${i + 1}. ${question}`}</Text>
                  <Input
                    key={`a${i}`}
                    placeholder="Your answer (optional)"
                    value={current.answers[i] ?? ''}
                    submitLabel={i === current.questions.length - 1 ? 'continue' : 'next'}
                    onInput={value =>
                      update($, phase, p =>
                        p.kind === 'questions'
                          ? {
                              ...p,
                              answers: p.answers.map((a, j) => (j === i ? value : a)),
                            }
                          : p,
                      )
                    }
                    onSubmit={() => {
                      if (i === current.questions.length - 1) {
                        inBackground($, proceed())
                      }
                    }}
                  />
                </Box>
              ))}
              <Box flexDirection="row" gap={1}>
                <Button
                  key="continue"
                  label="Continue"
                  variant="primary"
                  onPress={() => inBackground($, proceed())}
                />
                <Button
                  key="skip"
                  label="Skip questions"
                  onPress={() => inBackground($, improve($, current.original, []))}
                />
                <Button key="cancel" label="Cancel" onPress={() => cancel($)} />
              </Box>
            </Box>
          )
        }

        case 'preview':
          return (
            <Box flexDirection="column" gap={1}>
              <Text bold>Improved prompt</Text>
              <Box borderStyle="round" paddingX={1} flexDirection="column">
                <Text>{current.improved}</Text>
              </Box>
              {current.changes ? (
                <Text dimColor>{`What changed: ${current.changes}`}</Text>
              ) : null}
              <Box flexDirection="row" gap={1}>
                <Button
                  key="accept"
                  label="Accept"
                  variant="primary"
                  onPress={press => accept($, current.improved, press.surface)}
                />
                <Button
                  key="retry"
                  label="Retry"
                  onPress={() => inBackground($, improve($, current.original, current.qa))}
                />
                <Button key="discard" label="Discard" onPress={() => cancel($)} />
              </Box>
            </Box>
          )

        case 'error':
          return (
            <Box flexDirection="row" gap={1}>
              <Text color="red">{current.message}</Text>
              <Button
                key="again"
                label="Try again"
                onPress={() => inBackground($, improve($, current.original, null))}
              />
              <Button key="dismiss" label="Dismiss" onPress={() => cancel($)} />
            </Box>
          )
      }
    })()

    return (
      <Box flexDirection="row" gap={1}>
        <Box flexGrow={1}>{mine}</Box>
        {rest}
      </Box>
    )
  })
}
