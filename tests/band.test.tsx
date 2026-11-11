import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'prompt-improver',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 30,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const IMPROVED =
  'Fix the login failure after session timeout in src/auth/. Write a failing test first, then make it pass.'

test('Improve → preview → Accept fills the prompt box, on every surface', async ($, on) => {
  const filled: string[] = []
  on('prompt.read', () => ({ value: { text: 'fix the login bug', cursor: 17 } }))
  on('model.fork', () => ({
    value: {
      isAnswered: true,
      text: `<improved_prompt>\n${IMPROVED}\n</improved_prompt>\n<changes>named src/auth/, added a test check</changes>`,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  }))
  on('prompt.fill', (_, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    filled.length = 0
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Button', key: 'improve' })).toBeDefined()

    await ui.press({ key: 'improve' })

    expect((await ui.find({ type: 'Text', text: /session timeout/ }))?.text).toBe(IMPROVED)
    expect(await ui.find({ type: 'Text', text: /What changed/ })).toBeDefined()

    await ui.press({ key: 'accept' })
    expect(filled).toEqual([IMPROVED])
    await ui.unmount()
  }
})

test('clarifying questions are asked, then folded into the rewrite', async ($, on) => {
  const prompts: string[] = []
  on('prompt.read', () => ({ value: { text: 'add a widget', cursor: 12 } }))
  on('model.fork', (_, e) => {
    prompts.push(e.prompt)
    const usage = {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    }
    return {
      value:
        prompts.length === 1
          ? { isAnswered: true, usage, text: '<questions><q>Which widget?</q></questions>' }
          : { isAnswered: true, usage, text: '<improved_prompt>Build the calendar widget.</improved_prompt><changes>named the widget</changes>' },
    }
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'improve' })

  expect((await ui.find({ type: 'Text', text: /Which widget/ }))?.text).toBe('1. Which widget?')
  await ui.input({ key: 'a0', text: 'a calendar', kind: 'change' })
  await ui.press({ key: 'continue' })

  expect(prompts[1]).toContain('<answer>a calendar</answer>')
  expect(prompts[1]).not.toContain('<questions>\n<q>First question')
  expect(await ui.find({ type: 'Text', text: /Build the calendar widget/ })).toBeDefined()
  await ui.unmount()
})

test('with an empty box the button still shows, and pressing it calls no model', async ($, on) => {
  let modelCalls = 0
  on('prompt.read', () => ({ value: { text: '   ', cursor: 0 } }))
  on('model.fork', () => {
    modelCalls += 1
    return { value: { isAnswered: false, reason: 'nothing-to-fork' } }
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface, props: { ...BAND.props, isWorking: true } })
    await ui.press({ key: 'improve' })
    expect(modelCalls).toBe(0)
    expect(await ui.find({ type: 'Button', key: 'improve' })).toBeDefined()
    await ui.unmount()
  }
})
