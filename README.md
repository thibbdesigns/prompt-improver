# Prompt Improver

A Claude Code mod that puts a **✨ Improve prompt** button above the prompt box. Click it and your draft gets rewritten into a clearer, more detailed prompt before you send it.

## How it works

1. Type a prompt. The button shows up whenever the box has text and Claude isn't busy.
2. Click **✨ Improve prompt**. The mod sends your draft, along with the current conversation, to your session's model at your session's effort level. That way it can name the files, errors and decisions you've already discussed. On the first prompt of a session there's no conversation yet, so it uses Sonnet with the draft alone.
3. If your draft is missing something only you know, like which of two things you mean or what result you expect, you get up to 3 short questions. Answer them and press **Continue**, or press **Skip questions**.
4. A preview shows the improved prompt, with a one-line note on what changed. **Accept** replaces your draft, **Retry** rewrites it again, and **Discard** keeps your original. Your draft only changes when you press Accept.

## What a good prompt looks like

The rewrite follows Anthropic's [Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) and [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices):

- **Outcome first:** one direct sentence that starts with an action verb.
- **Specifics:** files, functions, errors and decisions from the conversation, never invented.
- **Context Claude can't see:** why it matters and which approach you prefer. Anything Claude would find by reading the code is left out.
- **What done looks like:** an observable result and a check that passes or fails.
- **Scope:** how ambitious to be, what's out of scope, and hard constraints, with the reason when it isn't obvious.
- **Calm, positive wording:** no ALL-CAPS, "you MUST", or "think step by step".
- **Proportional length:** a small task gets a few sentences, not a template.
- **Your voice kept:** your intent, facts, code and paths stay as you wrote them.

The improver's instructions are in [`hooks/instructions.ts`](hooks/instructions.ts) if you want to tune them.

## Install

At the prompt of a terminal Claude Code session:

```
/plugin install prompt-improver --marketplace thibbdesigns/prompt-improver
```

Answer `y` to add the marketplace, then choose the user scope.

From a shell:

```bash
claude plugin install prompt-improver --marketplace thibbdesigns/prompt-improver
```

In the Claude desktop app, where `/plugin` doesn't run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `thibbdesigns/prompt-improver`, then **Add plugin**.

## Notes

- Each click is one model call over your conversation, so it costs about as much as a short reply. The clarifying-questions step adds a second call.
- If the mod can't write to the prompt box, it copies the improved prompt to your clipboard and tells you.

## Development

```bash
claude plugin validate .
claude plugin test .
```

## License

MIT
