import type {
  ChatMessage,
  ToolInvocation,
  UiChatMessage,
  UiMessageSegment,
} from '../interfaces/Assistant';

/** Keep usable ordering metadata, falling back to the full message on corrupt/old stores. */
export function normalizeHistorySegments(
  value: unknown,
  content: string,
  tools: readonly ToolInvocation[],
): UiMessageSegment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = new Set(tools.map((tool) => tool.toolCallId));
  const seen = new Set<string>();
  const segments: UiMessageSegment[] = [];
  const parts: unknown[] = value;
  for (const part of parts) {
    if (!part || typeof part !== 'object' || !('type' in part)) continue;
    if (
      part.type === 'text' &&
      'text' in part &&
      typeof part.text === 'string'
    ) {
      segments.push({ type: 'text', text: part.text });
    } else if (
      part.type === 'tool-call' &&
      'toolCallId' in part &&
      typeof part.toolCallId === 'string' &&
      ids.has(part.toolCallId) &&
      !seen.has(part.toolCallId)
    ) {
      seen.add(part.toolCallId);
      segments.push({ type: 'tool-call', toolCallId: part.toolCallId });
    }
  }
  const text = segments
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('');
  return text === content && seen.size === ids.size && segments.length > 0
    ? segments
    : undefined;
}

/** Rebuild provider-neutral tool-use/result pairs, including tool-only and interrupted turns. */
export function buildChatHistory(
  messages: readonly UiChatMessage[],
): ChatMessage[] {
  const history: ChatMessage[] = [];
  for (const message of messages) {
    if (message.status === 'streaming') continue;
    if (message.role === 'user') {
      if (message.status === 'complete' && message.content) {
        history.push({ role: 'user', content: message.content });
      }
      continue;
    }
    const tools = new Map(
      (message.toolCalls ?? [])
        .filter(
          (tool) =>
            (tool.status === 'succeeded' || tool.status === 'failed') &&
            tool.toolCallId &&
            tool.toolName,
        )
        .map((tool) => [tool.toolCallId, tool]),
    );
    const segments = normalizeHistorySegments(
      message.segments,
      message.content,
      [...tools.values()],
    );
    const includeText = message.status === 'complete';
    let text = '';
    let pending: ToolInvocation[] = [];
    const flush = () => {
      if (!text && pending.length === 0) return;
      history.push({
        role: 'assistant',
        content: text,
        ...(pending.length > 0
          ? {
              toolCalls: pending.map((tool) => ({
                toolCallId: tool.toolCallId,
                toolName: tool.toolName,
                arguments: tool.arguments ?? {},
              })),
            }
          : {}),
      });
      for (const tool of pending) {
        const output =
          tool.status === 'succeeded'
            ? (tool.result ?? null)
            : {
                ok: false,
                error: tool.errorCode ?? 'execution_failed',
                ...(tool.errorMessage ? { message: tool.errorMessage } : {}),
              };
        history.push({
          role: 'tool',
          toolCallId: tool.toolCallId,
          toolName: tool.toolName,
          content: JSON.stringify(output),
        });
      }
      text = '';
      pending = [];
    };
    if (segments) {
      for (const part of segments) {
        if (part.type === 'text') {
          if (pending.length > 0) flush();
          if (includeText) text += part.text;
        } else {
          pending.push(tools.get(part.toolCallId)!);
        }
      }
    } else {
      // Old stores have no segment ordering. Retain every resolved call,
      // then the assistant's text (usually its final summary).
      pending = [...tools.values()];
      flush();
      if (includeText) text = message.content;
    }
    flush();
  }
  return history;
}
