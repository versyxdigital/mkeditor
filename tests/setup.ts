import '@testing-library/jest-dom';

// jsdom (as of the version jest pins) doesn't expose the WHATWG stream
// globals that the Vercel AI SDK relies on for SSE parsing. Bridge them
// from Node's `stream/web` so any test that imports through
// `src/app/lib/AppAssistant` (which loads `ai`) doesn't blow up at
// module-eval time. No-op on environments that already have them.
import {
  TransformStream as NodeTransformStream,
  ReadableStream as NodeReadableStream,
  WritableStream as NodeWritableStream,
} from 'node:stream/web';

type Streams = {
  TransformStream?: typeof NodeTransformStream;
  ReadableStream?: typeof NodeReadableStream;
  WritableStream?: typeof NodeWritableStream;
};
const g = globalThis as unknown as Streams;
if (typeof g.TransformStream === 'undefined') {
  g.TransformStream = NodeTransformStream;
}
if (typeof g.ReadableStream === 'undefined') {
  g.ReadableStream = NodeReadableStream;
}
if (typeof g.WritableStream === 'undefined') {
  g.WritableStream = NodeWritableStream;
}

// jsdom doesn't expose `TextEncoder` / `TextDecoder` either. The
// Markdown singleton's code-fence renderer base64s the source via
// `TextEncoder` for a copy-source data attribute — so any test that
// renders a fenced code block (AI Assistant P4 onward via
// `renderAssistantMarkdown`) needs these globals present.
import { TextEncoder, TextDecoder } from 'node:util';
type TextCodecs = {
  TextEncoder?: typeof TextEncoder;
  TextDecoder?: typeof TextDecoder;
};
const tg = globalThis as unknown as TextCodecs;
if (typeof tg.TextEncoder === 'undefined') tg.TextEncoder = TextEncoder;
if (typeof tg.TextDecoder === 'undefined') tg.TextDecoder = TextDecoder;
