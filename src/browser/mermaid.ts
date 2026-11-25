import {
  darkPalette,
  lightPalette,
  interfaceFont,
} from '../app/shared/designTokens';

let queue = Promise.resolve();
let sequence = 0;
const cache = new WeakMap<HTMLElement, Map<string, string | null>>();

/** Lazy diagram rendering shared by chat, the document preview and exports. */
export async function renderMermaidDiagrams(
  host: HTMLElement,
  dark: boolean,
  signal: AbortSignal,
  { className = 'md-diagram' }: { className?: string } = {},
): Promise<void> {
  let saved = cache.get(host);
  if (!saved) {
    saved = new Map();
    cache.set(host, saved);
  }
  let index = 0;
  for (const block of host.querySelectorAll<HTMLElement>(
    '[data-diagram="mermaid"]',
  )) {
    const encoded = block.getAttribute('data-source');
    if (!encoded || signal.aborted) continue;
    let source: string;
    try {
      source = new TextDecoder().decode(
        Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)),
      );
    } catch {
      continue;
    }
    if (source.length > 20_000) continue;
    const key = `${dark}:${index++}:${source}`;
    const remember = (value: string | null) => {
      saved.set(key, value);
      if (saved.size > 40) saved.delete(saved.keys().next().value!);
    };

    const task = async () => {
      if (signal.aborted || !host.contains(block)) return;
      const insert = (svg: string) => {
        const diagram = document.createElement('div');
        diagram.className = className;
        diagram.tabIndex = 0;
        diagram.innerHTML = svg;
        const code = block.querySelector('pre');
        if (code) code.hidden = true;
        block
          .querySelectorAll(`.${className}`)
          .forEach((previous) => previous.remove());
        block.append(diagram);
      };
      if (saved.has(key)) {
        const svg = saved.get(key);
        if (svg) insert(svg);
        return;
      }
      const [{ default: mermaid }, { default: DOMPurify }] = await Promise.all([
        import('mermaid'),
        import('dompurify'),
      ]);
      if (signal.aborted || !host.contains(block)) return;
      const palette = dark ? darkPalette : lightPalette;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        theme: 'base',
        look: 'classic',
        htmlLabels: false,
        themeVariables: {
          background: palette['bg-editor'],
          primaryColor: palette['accent-subtle'],
          primaryTextColor: palette['text-primary'],
          primaryBorderColor: palette['accent-primary'],
          lineColor: palette['text-secondary'],
          secondaryColor: palette['bg-elevated'],
          tertiaryColor: palette['bg-hover'],
          fontFamily: interfaceFont,
          fontSize: '13px',
        },
        flowchart: { htmlLabels: false },
        maxTextSize: 20_000,
        maxEdges: 200,
        secure: [
          'secure',
          'securityLevel',
          'startOnLoad',
          'maxTextSize',
          'maxEdges',
          'suppressErrorRendering',
          'theme',
          'look',
          'themeVariables',
          'themeCSS',
          'flowchart',
          'htmlLabels',
        ],
      });
      const workspace = document.createElement('div');
      workspace.style.cssText =
        'position:fixed;left:-100000px;top:0;pointer-events:none;';
      workspace.setAttribute('aria-hidden', 'true');
      document.body.append(workspace);
      try {
        const { svg } = await mermaid.render(
          `assistant-diagram-${++sequence}`,
          source,
          workspace,
        );
        if (signal.aborted || !host.contains(block)) return;
        const sanitized = DOMPurify.sanitize(svg, {
          USE_PROFILES: { svg: true, svgFilters: true },
          FORBID_TAGS: ['foreignObject', 'image', 'a'],
        });
        remember(sanitized);
        insert(sanitized);
      } catch {
        remember(null);
      } finally {
        workspace.remove();
      }
    };
    // Mermaid owns mutable configuration, so serialize diagrams across messages.
    // Invalid or partial diagrams retain their readable code and copy action.
    queue = queue.then(task).catch(() => {});
    await queue;
  }
}
