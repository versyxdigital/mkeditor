import { waitFor } from '@testing-library/react';
import mermaid from 'mermaid';
import { renderMermaidDiagrams } from '../src/browser/mermaid';
import { HTMLExporter } from '../src/browser/core/HTMLExporter';
import { Markdown } from '../src/browser/core/Markdown';
import { exportSettings } from '../src/browser/config';

jest.mock('mermaid', () => ({
  __esModule: true,
  default: { initialize: jest.fn(), render: jest.fn() },
}));

const source = '```mermaid\nflowchart LR\nDraft --> Review\n```';
const markedHTML = () =>
  `<div id="preview-content">${Markdown.render(source)}</div>`;

beforeEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';
  jest.mocked(mermaid.render).mockImplementation(async (id) => ({
    svg: `<svg id="${id}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><style>#${id} .node { fill: teal; }</style><text class="node">Draft</text><script>alert(1)</script></svg>`,
    diagramType: 'flowchart-v2',
  }));
});

test('document fences retain source metadata and copy text, and unchanged diagrams reuse their SVG', async () => {
  const host = document.createElement('div');
  host.innerHTML = markedHTML();
  document.body.append(host);
  const block = host.querySelector('[data-diagram="mermaid"]')!;
  expect(block.getAttribute('data-line-start')).toBe('1');
  expect(block.getAttribute('data-source')).toBe(
    btoa('flowchart LR\nDraft --> Review\n'),
  );
  await renderMermaidDiagrams(host, false, new AbortController().signal);
  expect(host.querySelector('.md-diagram svg text')?.textContent).toBe('Draft');
  expect(host.querySelector('script')).toBeNull();
  expect(host.querySelector('pre')).toHaveProperty('hidden', true);
  host.innerHTML = '<p>A changed paragraph.</p>' + markedHTML();
  await renderMermaidDiagrams(host, false, new AbortController().signal);
  expect(mermaid.render).toHaveBeenCalledTimes(1);
  host.innerHTML = markedHTML().replace(
    btoa('flowchart LR\nDraft --> Review\n'),
    btoa('flowchart LR\nReview --> Publish\n'),
  );
  await renderMermaidDiagrams(host, false, new AbortController().signal);
  expect(mermaid.render).toHaveBeenCalledTimes(2);
});

test.each([true, false])(
  'HTML exports embed sanitized, self-contained diagrams withStyles=%s',
  async (withStyles) => {
    const exported = new DOMParser().parseFromString(
      await HTMLExporter.prepareHTML(markedHTML(), {
        ...exportSettings,
        withStyles,
      }),
      'text/html',
    );
    expect(exported.querySelector('figure svg text')?.textContent).toBe(
      'Draft',
    );
    expect(exported.querySelector('svg .node')).not.toBeNull();
    expect(exported.querySelector('svg style')?.textContent).toContain(
      'fill: teal',
    );
    expect(
      exported.querySelector(
        'pre, .md-codeblock-header, [data-source], [data-diagram]',
      ),
    ).toBeNull();
    expect(exported.querySelector('script[src*="mermaid"]')).toBeNull();
    expect(exported.querySelector('svg script')).toBeNull();
  },
);

test('export waits for the diagram snapshot, and invalid diagrams retain their source', async () => {
  let complete!: (value: { svg: string; diagramType: string }) => void;
  jest.mocked(mermaid.render).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  let finished = false;
  const pending = HTMLExporter.prepareHTML(markedHTML(), exportSettings).then(
    (html) => {
      finished = true;
      return html;
    },
  );
  await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(1));
  expect(finished).toBe(false);
  complete({
    svg: '<svg><text>Ready</text></svg>',
    diagramType: 'flowchart-v2',
  });
  expect(await pending).toContain('Ready');
  jest.mocked(mermaid.render).mockRejectedValueOnce(new Error('invalid graph'));
  const invalid = new DOMParser().parseFromString(
    await HTMLExporter.prepareHTML(markedHTML(), exportSettings),
    'text/html',
  );
  expect(invalid.querySelector('pre')?.textContent).toContain(
    'Draft --> Review',
  );
  expect(invalid.querySelector('pre')).toHaveProperty('hidden', false);
});
