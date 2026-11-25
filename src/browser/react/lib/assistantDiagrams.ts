import { renderMermaidDiagrams } from '../../mermaid';

/** Chat shares the document renderer while retaining its own presentation. */
export function renderAssistantDiagrams(
  host: HTMLElement,
  dark: boolean,
  signal: AbortSignal,
): Promise<void> {
  return renderMermaidDiagrams(host, dark, signal, {
    className: 'assistant-diagram',
  });
}
