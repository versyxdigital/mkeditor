// Run in Node so this exercises the installed ESM SDKs outside Jest's VM.
const assert = require('node:assert/strict');
const { streamText, tool, jsonSchema, isStepCount } = require('ai');
const { createOpenAI } = require('@ai-sdk/openai');

async function main() {
  const bodies = [];
  const item = {
    type: 'function_call',
    id: 'fc_1',
    call_id: 'call_1',
    name: 'edit_file',
    namespace: 'mkeditor',
    arguments: '{}',
    status: 'completed',
  };
  const model = createOpenAI({
    apiKey: 'test-subscription-token',
    fetch: async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      const body = JSON.parse(options.body);
      bodies.push(body);
      const events = [
        {
          type: 'response.created',
          response: { id: 'resp_1', created_at: 1, model: 'gpt-6.2-sol' },
        },
        ...(bodies.length === 1
          ? [
              {
                type: 'response.output_item.added',
                output_index: 0,
                item: { ...item, arguments: '' },
              },
              { type: 'response.output_item.done', output_index: 0, item },
            ]
          : []),
        {
          type: 'response.completed',
          response: {
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          },
        },
      ];
      return new Response(
        events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
        {
          headers: { 'Content-Type': 'text/event-stream' },
        },
      );
    },
  }).responses('gpt-6.2-sol');
  const options = {
    model,
    include: { rawChunks: true },
    providerOptions: {
      openai: { store: false, systemMessageMode: 'developer' },
    },
    instructions: [
      { role: 'system', content: 'Only explicitly shared context' },
    ],
    tools: {
      edit_file: tool({
        description: 'Edit a document',
        inputSchema: jsonSchema({
          type: 'object',
          properties: {},
          additionalProperties: false,
        }),
        providerOptions: {
          openai: {
            namespace: {
              name: 'mkeditor',
              description: 'MKEditor document tools',
            },
          },
        },
      }),
    },
    stopWhen: isStepCount(1),
  };
  const messages = [{ role: 'user', content: 'Edit the document' }];
  const first = streamText({ ...options, messages });
  const chunks = [];
  for await (const chunk of first.stream) {
    if (chunk.type === 'error') throw chunk.error;
    chunks.push(chunk);
  }
  assert(
    chunks.some(
      (chunk) =>
        chunk.type === 'tool-call' &&
        chunk.toolName === 'edit_file' &&
        chunk.toolCallId === 'call_1',
    ),
  );
  assert.equal(await first.finishReason, 'tool-calls');
  assert(
    chunks.some(
      (chunk) =>
        chunk.type === 'raw' && chunk.rawValue.type === 'response.completed',
    ),
  );
  const body = bodies[0];
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  assert(!('max_output_tokens' in body));
  assert(body.input.some((input) => input.role === 'developer'));
  assert(!body.input.some((input) => input.role === 'system'));
  assert.equal(body.tools[0].type, 'namespace');
  assert.equal(body.tools[0].name, 'mkeditor');
  assert.equal(body.tools[0].tools[0].name, 'edit_file');
  const second = streamText({
    ...options,
    messages: [
      ...messages,
      ...(await first.responseMessages),
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_1',
            toolName: 'edit_file',
            output: { type: 'json', value: { ok: true } },
          },
        ],
      },
    ],
  });
  for await (const chunk of second.stream)
    if (chunk.type === 'error') throw chunk.error;
  assert.equal(await second.finishReason, 'stop');
  assert(
    bodies[1].input.some(
      (input) =>
        input.type === 'function_call' &&
        input.namespace === 'mkeditor' &&
        input.call_id === 'call_1',
    ),
  );
  assert(
    bodies[1].input.some(
      (input) =>
        input.type === 'function_call_output' && input.call_id === 'call_1',
    ),
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
