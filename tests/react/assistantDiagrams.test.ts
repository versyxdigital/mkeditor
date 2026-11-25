import { renderAssistantDiagrams } from '../../src/browser/react/lib/assistantDiagrams';
import mermaid from 'mermaid';

jest.mock('mermaid', () => ({
  __esModule: true,
  default: { initialize: jest.fn(), render: jest.fn() },
}));

function fixture(source = 'graph TD\nA --> B') {
  const host = document.createElement('div');
  host.innerHTML =
    '<div class="md-codeblock" data-diagram="mermaid"><pre>original code</pre></div>';
  host.firstElementChild!.setAttribute('data-source', btoa(source));
  document.body.append(host);
  return host;
}
beforeEach(() => {
  document.body.innerHTML = '';
  jest.clearAllMocks();
  jest.mocked(mermaid.render).mockResolvedValue({
    svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>Diagram</text><script>alert(1)</script><image href="https://example.test" /></svg>',
    diagramType: 'flowchart-v2',
  });
});

test('inserts sanitized SVG, retains copy source and replaces diagrams when the theme changes', async () => {
  const host = fixture();
  const controller = new AbortController();
  await renderAssistantDiagrams(host, true, controller.signal);
  expect(host.querySelector('.assistant-diagram svg')).not.toBeNull();
  expect(host.querySelector('script, image')).toBeNull();
  expect(host.querySelector('pre')).toHaveProperty('hidden', true);
  expect(host.firstElementChild!.getAttribute('data-source')).toBe(
    btoa('graph TD\nA --> B'),
  );
  await renderAssistantDiagrams(host, false, controller.signal);
  expect(host.querySelectorAll('.assistant-diagram')).toHaveLength(1);
  expect(mermaid.initialize).toHaveBeenLastCalledWith(
    expect.objectContaining({
      securityLevel: 'strict',
      startOnLoad: false,
      theme: 'base',
      htmlLabels: false,
    }),
  );
  expect(document.body.children).toHaveLength(1);
});

test('invalid diagrams leave readable code and do not leave temporary rendering elements', async () => {
  jest.mocked(mermaid.render).mockRejectedValue(new Error('invalid source'));
  const host = fixture();
  await renderAssistantDiagrams(host, false, new AbortController().signal);
  expect(host.querySelector('pre')).toHaveProperty('hidden', false);
  expect(host.querySelector('.assistant-diagram')).toBeNull();
  expect(document.body.children).toHaveLength(1);
});

test('an aborted render cannot write into an old message', async () => {
  const controller = new AbortController();
  jest.mocked(mermaid.render).mockImplementationOnce(async () => {
    controller.abort();
    return { svg: '<svg></svg>', diagramType: 'flowchart-v2' };
  });
  const host = fixture();
  await renderAssistantDiagrams(host, true, controller.signal);
  expect(host.querySelector('.assistant-diagram')).toBeNull();
  expect(host.querySelector('pre')).toHaveProperty('hidden', false);
  expect(document.body.children).toHaveLength(1);
});
