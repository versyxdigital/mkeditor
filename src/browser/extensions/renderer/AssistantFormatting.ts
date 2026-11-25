import type { MarkdownIt, StateBlock, StateInline } from 'markdown-it';
import footnote from 'markdown-it-footnote';
import { full as emoji } from 'markdown-it-emoji';

export const assistantFeatureRules = [
  'footnote_def',
  'footnote_inline',
  'footnote_ref',
  'footnote_tail',
  'emoji',
];

const inlineTags = new Set([
  'sup',
  'sub',
  'kbd',
  'mark',
  'u',
  'strong',
  'b',
  'em',
  'i',
  's',
  'del',
  'span',
  'br',
]);

// Only these generated tags are emitted. html:false stays in force, and no
// model-supplied attributes, CSS, URLs or event handlers reach the DOM.
function safeInline(state: StateInline, silent: boolean): boolean {
  if (state.env.assistantChat !== true || state.src[state.pos] !== '<')
    return false;
  const source = state.src.slice(state.pos);
  const comment = /^<!--[\s\S]*?-->/.exec(source);
  const tag = /^<(\/?)([a-z]+)(?:\s+[^<>]*?)?\s*\/?>/i.exec(source);
  if (!comment && (!tag || !inlineTags.has(tag[2].toLowerCase()))) return false;
  if (!silent && tag && !comment) {
    const token = state.push('html_inline', '', 0);
    token.content = `<${tag[1]}${tag[2].toLowerCase()}>`;
  }
  state.pos += (comment ?? tag)![0].length;
  return true;
}

function safeBlock(
  state: StateBlock,
  start: number,
  _end: number,
  silent: boolean,
): boolean {
  if (
    state.env.assistantChat !== true ||
    state.sCount[start] - state.blkIndent >= 4
  )
    return false;
  const line = state.src
    .slice(state.bMarks[start] + state.tShift[start], state.eMarks[start])
    .trim();
  const summary = /^<summary(?:\s+[^<>]*?)?>(.*)<\/summary>$/i.exec(line);
  const tag = /^<(\/?)(details|div)(?:\s+[^<>]*?)?\s*>$/i.exec(line);
  const comment = /^<!--[\s\S]*-->$/.test(line);
  if (!summary && !tag && !comment) return false;
  if (silent) return true;
  const stack = (state.env.assistantHtmlStack ??= []) as string[];
  if (summary) {
    if (!stack.includes('details')) return false;
    state.push('html_block', '', 0).content = '<summary>';
    const inline = state.push('inline', '', 0);
    inline.content = summary[1];
    inline.children = [];
    state.push('html_block', '', 0).content = '</summary>\n';
  } else if (tag) {
    const name = tag[2].toLowerCase();
    if (tag[1]) {
      if (stack.at(-1) !== name) return false;
      stack.pop();
      state.push('html_block', '', 0).content = `</${name}>\n`;
    } else {
      stack.push(name);
      state.push('html_block', '', 0).content =
        name === 'div'
          ? '<div class="assistant-html-panel">\n'
          : `<details${/\sopen(?:\s|=|>)/i.test(line) ? ' open' : ''}>\n`;
    }
  }
  state.line = start + 1;
  return true;
}

function slug(text: string): string {
  return (
    text
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .trim()
      .replace(/\s+/g, '-') || 'section'
  );
}

const AssistantFormatting = (md: MarkdownIt) => {
  md.use(footnote);
  md.use(emoji, { shortcuts: {} });
  md.disable(assistantFeatureRules);
  md.inline.ruler.before('html_inline', 'assistant_safe_inline', safeInline);
  md.block.ruler.before('html_block', 'assistant_safe_block', safeBlock, {
    alt: ['paragraph'],
  });
  md.renderer.rules.assistant_alert_title = (tokens, idx) =>
    `<p class="assistant-alert-title">${md.utils.escapeHtml(tokens[idx].content)}</p>\n`;
  md.core.ruler.after('inline', 'assistant_formatting', (state) => {
    if (state.env.assistantChat !== true) return;
    const prefix =
      typeof state.env.docId === 'string' ? state.env.docId : 'assistant';
    const headings = new Map<string, number>();
    const lists: typeof state.tokens = [];
    for (let i = 0; i < state.tokens.length; i++) {
      const token = state.tokens[i];
      if (token.type === 'heading_open') {
        const text =
          state.tokens[i + 1].children
            ?.filter(
              (child) => child.type === 'text' || child.type === 'code_inline',
            )
            .map((child) => child.content)
            .join('') ?? '';
        const base = slug(text);
        const count = (headings.get(base) ?? 0) + 1;
        headings.set(base, count);
        token.attrSet('id', `${prefix}-${base}${count > 1 ? `-${count}` : ''}`);
        token.attrSet('tabindex', '-1');
      }
      if (
        token.type === 'bullet_list_open' ||
        token.type === 'ordered_list_open'
      )
        lists.push(token);
      if (
        token.type === 'bullet_list_close' ||
        token.type === 'ordered_list_close'
      )
        lists.pop();
      if (token.type === 'list_item_open') {
        const inline = state.tokens[i + 2];
        const first =
          inline?.type === 'inline' ? inline.children?.[0] : undefined;
        const task =
          first?.type === 'text' ? /^\[([ xX])\]\s+/.exec(first.content) : null;
        if (task && first && inline.children) {
          token.attrJoin('class', 'task-list-item');
          lists.at(-1)?.attrJoin('class', 'contains-task-list');
          first.content = first.content.slice(task[0].length);
          const label = inline.children
            .filter((child) =>
              ['text', 'code_inline', 'image'].includes(child.type),
            )
            .map((child) => child.content)
            .join('');
          const checkbox = new state.Token('html_inline', '', 0);
          checkbox.content = `<input type="checkbox" aria-label="${md.utils.escapeHtml(label)}" disabled${task[1] !== ' ' ? ' checked' : ''}> `;
          inline.children.unshift(checkbox);
        }
      }
      if (token.type === 'blockquote_open') {
        const inline = state.tokens[i + 2];
        const first =
          inline?.type === 'inline' ? inline.children?.[0] : undefined;
        const alert =
          first?.type === 'text'
            ? /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s|$)/.exec(
                first.content,
              )
            : null;
        if (alert && first && inline.children) {
          token.tag = 'aside';
          token.attrJoin(
            'class',
            `assistant-alert assistant-alert-${alert[1].toLowerCase()}`,
          );
          let depth = 1;
          for (let j = i + 1; j < state.tokens.length; j++) {
            if (state.tokens[j].type === 'blockquote_open') depth++;
            if (state.tokens[j].type === 'blockquote_close' && --depth === 0) {
              state.tokens[j].tag = 'aside';
              break;
            }
          }
          first.content = first.content.slice(alert[0].length);
          if (!first.content) {
            inline.children.shift();
            if (
              inline.children[0]?.type === 'softbreak' ||
              inline.children[0]?.type === 'hardbreak'
            )
              inline.children.shift();
          }
          const title = new state.Token('assistant_alert_title', '', 0);
          title.content = alert[1];
          state.tokens.splice(i + 1, 0, title);
        }
      }
      for (const child of token.children ?? []) {
        if (child.type === 'link_open') {
          const href = child.attrGet('href');
          if (typeof href === 'string' && href.startsWith('#')) {
            let fragment = href.slice(1);
            try {
              fragment = decodeURIComponent(fragment);
            } catch {
              /* Keep malformed fragments inert. */
            }
            child.attrSet('href', `#${prefix}-${fragment}`);
          }
          child.attrSet('rel', 'noopener noreferrer');
        }
        if (child.type === 'image') {
          child.attrSet('loading', 'lazy');
          child.attrSet('decoding', 'async');
          child.attrSet('referrerpolicy', 'no-referrer');
        }
      }
    }
    // A partially streamed HTML container must end within this message.
    const stack = state.env.assistantHtmlStack as string[] | undefined;
    for (const tag of stack?.reverse() ?? []) {
      const close = new state.Token('html_block', '', 0);
      close.content = `</${tag}>\n`;
      state.tokens.push(close);
    }
  });
};

export default AssistantFormatting;
