import { readFileSync } from 'fs';
import { join } from 'path';
import {
  Markdown,
  renderAssistantMarkdown,
} from '../src/browser/core/Markdown';

const fixture = readFileSync(
  join(__dirname, 'fixtures/assistant-rendering.md'),
  'utf8',
);
const render = (source = fixture, documentId = 'message-1') =>
  new DOMParser().parseFromString(
    renderAssistantMarkdown(source, {
      scrollableTables: true,
      chat: { documentId, copyLabel: 'Copy code' },
    }),
    'text/html',
  );

test('the complete chat fixture renders headings, nested lists, tasks, code, tables and math', () => {
  const doc = render();
  for (let level = 1; level <= 6; level++)
    expect(doc.querySelector(`h${level}`)).not.toBeNull();
  expect(doc.querySelector('ul ul ul')).not.toBeNull();
  expect(doc.querySelector('ol ol')).not.toBeNull();
  expect(doc.querySelector('blockquote blockquote blockquote')).not.toBeNull();
  expect(doc.querySelectorAll('.task-list-item input[disabled]')).toHaveLength(
    5,
  );
  expect(doc.querySelectorAll('.task-list-item input[checked]')).toHaveLength(
    3,
  );
  expect(doc.querySelectorAll('.assistant-table-scroll table')).toHaveLength(2);
  expect(doc.querySelectorAll('.md-codeblock')).toHaveLength(11);
  expect(
    [...doc.querySelectorAll('.task-list-item input')].every((input) =>
      Boolean(input.getAttribute('aria-label')),
    ),
  ).toBe(true);
  expect(doc.querySelector('.katex')).not.toBeNull();
  expect(doc.querySelector('.katex-display')).not.toBeNull();
  expect(doc.querySelectorAll('[data-diagram="mermaid"]')).toHaveLength(2);
  expect(
    doc.querySelector('.md-codeblock-copy')?.getAttribute('aria-label'),
  ).toBe('Copy code');
  expect(doc.body.textContent).toContain('End of test document.');
});

test('heading links and footnotes have unique message-scoped targets', () => {
  const first = render();
  const second = render(fixture, 'message-2');
  const ids = [
    ...first.querySelectorAll('[id]'),
    ...second.querySelectorAll('[id]'),
  ].map((node) => node.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const doc of [first, second]) {
    for (const link of doc.querySelectorAll('a[href^="#"]')) {
      expect(
        doc.getElementById(link.getAttribute('href')!.slice(1)),
      ).not.toBeNull();
      expect(link.getAttribute('target')).not.toBe('_blank');
    }
  }
  const duplicate = render('## Repeat\n\n## Repeat');
  expect(duplicate.querySelectorAll('h2')[1].id).toBe('message-1-repeat-2');
});

test('safe HTML, alerts and emoji render without admitting arbitrary HTML or attributes', () => {
  const doc = render(
    fixture +
      '\n\n<sup onclick="alert(1)" style="color:red">safe</sup>\n\n<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\n<iframe src=x></iframe>',
  );
  expect(doc.querySelector('sub')?.textContent).toBe('2');
  expect(doc.querySelector('kbd')?.textContent).toBe('Ctrl');
  expect(doc.querySelector('details summary')?.textContent).toContain(
    'Click to expand',
  );
  expect(doc.querySelector('.assistant-html-panel strong')?.textContent).toBe(
    'HTML panel',
  );
  expect(doc.querySelectorAll('.assistant-alert')).toHaveLength(5);
  expect(doc.querySelector('.assistant-alert-note')?.textContent).not.toContain(
    '[!NOTE]',
  );
  expect(doc.body.textContent).not.toContain(':smile:');
  expect(doc.body.textContent).not.toContain(
    'This comment must not be visible',
  );
  expect(doc.querySelector('script, iframe, [onclick], [onerror]')).toBeNull();
  expect(
    doc.querySelector('.assistant-html-panel')?.hasAttribute('style'),
  ).toBe(false);
  expect(doc.querySelector('img[src="x"]')).toBeNull();
});

test('partial streams stay contained and chat extensions do not change document rendering', () => {
  for (const source of [
    '<details>\n<summary>More</summary>\n\n**Partial',
    '<div>\n\npartial',
    '- [x] Done\n- [',
    '> [!NOTE]\n> Partial',
    '```mermaid\ngraph TD\nA -->',
  ]) {
    expect(() => render(source)).not.toThrow();
    expect(Markdown.options.html).toBe(true);
  }
  const document = new DOMParser().parseFromString(
    Markdown.render('- [x] Plain\n\nnote[^n]\n\n[^n]: Text\n\n:smile:'),
    'text/html',
  );
  expect(document.querySelector('input, .footnote-ref')).toBeNull();
  expect(document.body.textContent).toContain(':smile:');
  expect(renderAssistantMarkdown('<sup>2</sup>')).toContain('&lt;sup&gt;');
});
