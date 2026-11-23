import { Worker } from 'worker_threads';
import { WorkspaceToolError } from '../shared/workspacePaths';

export interface WorkspaceRegexResult {
  content?: string;
  count: number;
  matches: Array<{ index: number; text: string }>;
  truncated: boolean;
}

/** Untrusted regular expressions must never block the renderer or Electron main. */
export function runWorkspaceRegex(input: {
  content: string;
  query: string;
  replacement?: string;
  caseSensitive?: boolean;
  limit?: number;
}): Promise<WorkspaceRegexResult> {
  if (
    typeof input.content !== 'string' ||
    typeof input.query !== 'string' ||
    input.content.length > 4 * 1024 * 1024 ||
    input.query.length > 1000 ||
    (input.replacement !== undefined && typeof input.replacement !== 'string')
  )
    return Promise.reject(
      new WorkspaceToolError(
        'invalid_arguments',
        'Invalid or oversized regular expression input.',
      ),
    );
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      `
      const { parentPort, workerData: input } = require('worker_threads');
      try {
        const expression = new RegExp(input.query, input.caseSensitive === false ? 'gi' : 'g');
        const matches = []; let count = 0; let truncated = false;
        for (const match of input.content.matchAll(expression)) {
          count++;
          if (input.replacement !== undefined && input.content.length + count * input.replacement.length > 8 * 1024 * 1024) throw new Error('Replacement output exceeds 8 MiB.');
          if (matches.length < Math.min(501, input.limit ?? 501)) matches.push({ index: match.index, text: match[0] });
          else if (input.replacement === undefined) { truncated = true; break; }
        }
        const content = input.replacement === undefined ? undefined : input.content.replace(expression, input.replacement);
        parentPort.postMessage({ ok: true, value: { content, count, matches, truncated } });
      } catch (error) { parentPort.postMessage({ ok: false, message: String(error) }); }
    `,
      {
        eval: true,
        workerData: input,
        resourceLimits: { maxOldGenerationSizeMb: 128 },
      },
    );
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(
        new WorkspaceToolError(
          'regex_timeout',
          'Regular expression exceeded the one-second time limit. Use a simpler expression.',
        ),
      );
    }, 1000);
    const finish = () => {
      clearTimeout(timer);
      void worker.terminate();
    };
    worker.once(
      'message',
      (message: {
        ok: boolean;
        value: WorkspaceRegexResult;
        message: string;
      }) => {
        finish();
        if (message.ok) resolve(message.value);
        else reject(new WorkspaceToolError('invalid_regex', message.message));
      },
    );
    worker.once('error', (error) => {
      finish();
      reject(error);
    });
    worker.once('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0)
        reject(
          new WorkspaceToolError(
            'regex_failed',
            'Regular expression worker stopped.',
          ),
        );
    });
  });
}
