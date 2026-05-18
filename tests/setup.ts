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
