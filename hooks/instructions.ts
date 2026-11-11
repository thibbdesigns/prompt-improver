// The instructions the improver sends to the model, distilled from Anthropic's
// "Prompting best practices" and "Best practices for Claude Code" guides.

import type { QA } from '../types'

const PRACTICES = `Rewrite the draft so that a capable colleague who has followed this conversation could act on it without needing to ask anything. Apply these practices, which come from Anthropic's prompting guidance:

1. Lead with the outcome. Open with one direct sentence, starting with an action verb, that says what to do.
2. Name the specifics. Bring in the concrete details that are already established: files, functions, commands, error messages, decisions made, approaches already tried. Use only facts that appear in the draft or the conversation; never invent paths, numbers, names or requirements.
3. Add the context Claude can't see. Include why the work matters, who it's for, and any preference between reasonable approaches. Leave out what Claude would find quickly by reading the code itself.
4. Say what done looks like. Describe the observable result and, for code, a check that comes back pass or fail (a test, a build, a command, a screenshot), and ask for evidence of it.
5. Set the scope. Say how ambitious to be ("be ambitious: handle the edge cases" or "keep the change minimal"), what is out of scope, and hard constraints (no new dependencies, keep the public API stable). Give the reason behind a constraint when it isn't obvious, so it can be generalised.
6. Phrase instructions as what to do rather than what not to do, in calm, plain language. Avoid ALL-CAPS, "you MUST", and filler like "think step by step" or "be thorough".
7. Use a numbered list only where order or completeness matters. Wrap pasted material (logs, data, examples, documents) in descriptive XML tags so it stays separate from the instructions.
8. Keep it proportional. A small task gets a few clear sentences, not a template; a large one gets a short structured brief. Add no headings, preamble or boilerplate that the task doesn't need.
9. Preserve the person. Keep their intent, their voice (first person, addressed to Claude), and every fact, constraint, example, code snippet, path and quotation they gave, verbatim where exact wording matters. Don't change what they're asking for.`

const ASK_IF_NEEDED = `Questions: if, and only if, the draft is missing information that only the person knows and that would materially change the work (which of several things they mean, what result they expect, a hard constraint), and neither the draft nor the conversation answers it, ask instead of rewriting. Ask at most 3 short, specific questions. Don't ask about anything you can reasonably infer or that Claude could find by reading the code. If the draft is clear enough, rewrite it straight away.`

const NO_QUESTIONS = `Questions: don't ask any; produce the rewritten prompt now. Where something is still unknown, choose the most reasonable reading and state it briefly in the prompt as an assumption the person can correct.`

const FORMAT_WITH_QUESTIONS = `Reply with exactly one of these two forms and nothing else, no text before or after:

<questions>
<q>First question</q>
<q>Second question</q>
</questions>

or

<improved_prompt>
The full rewritten prompt, ready to send as-is.
</improved_prompt>
<changes>One short line saying what you added or changed, for example: named src/auth/token.ts, added a failing-test check, scoped out UI changes</changes>`

const FORMAT_FINAL = `Reply with exactly this form and nothing else, no text before or after:

<improved_prompt>
The full rewritten prompt, ready to send as-is.
</improved_prompt>
<changes>One short line saying what you added or changed, for example: named src/auth/token.ts, added a failing-test check, scoped out UI changes</changes>`

/**
 * The one message sent to the model. `qa` is null on the first pass (questions
 * allowed), else the answers so far (an empty list when the person skipped).
 */
export function buildPrompt(
  draft: string,
  qa: QA[] | null,
  hasConversation: boolean,
): string {
  const role = hasConversation
    ? `For this one reply, act as a prompt editor rather than as the assistant doing the work. The person has drafted their next message to you in this session and wants it rewritten into a clearer, more detailed prompt before they send it. You have no tools for this reply: answer straight away from what you already know of this conversation, without starting the task itself.`
    : `Act as a prompt editor. Someone has drafted a message to Claude, an AI coding assistant working in their project, and wants it rewritten into a clearer, more detailed prompt before they send it. You can't see their project or conversation, so don't guess at specifics like file names: ask about them or mark them as an assumption.`

  const answered =
    qa && qa.length > 0
      ? `\n\nThe person answered these questions about the draft. Fold the answers into the rewritten prompt:\n<answers>\n${qa
          .map(
            one =>
              `<qa>\n<question>${one.question}</question>\n<answer>${one.answer.trim() || '(no answer)'}</answer>\n</qa>`,
          )
          .join('\n')}\n</answers>`
      : ''

  return [
    role,
    `<draft>\n${draft}\n</draft>${answered}`,
    PRACTICES,
    qa === null ? ASK_IF_NEEDED : NO_QUESTIONS,
    qa === null ? FORMAT_WITH_QUESTIONS : FORMAT_FINAL,
  ].join('\n\n')
}

export type Parsed =
  | { kind: 'questions'; questions: string[] }
  | { kind: 'improved'; improved: string; changes: string }

/** Reads the model's tagged reply; untagged text is taken as the prompt. */
export function parseReply(text: string): Parsed {
  const improved = /<improved_prompt>\s*([\s\S]*?)\s*<\/improved_prompt>/.exec(
    text,
  )
  if (improved?.[1]) {
    const changes = /<changes>\s*([\s\S]*?)\s*<\/changes>/.exec(text)
    return {
      kind: 'improved',
      improved: improved[1],
      changes: changes?.[1]?.replace(/\s+/g, ' ') ?? '',
    }
  }

  const questions = [...text.matchAll(/<q>\s*([\s\S]*?)\s*<\/q>/g)]
    .map(m => m[1] ?? '')
    .filter(q => q.length > 0)
    .slice(0, 3)
  if (questions.length > 0) {
    return { kind: 'questions', questions }
  }

  return { kind: 'improved', improved: text.trim(), changes: '' }
}
