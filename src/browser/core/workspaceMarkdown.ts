import MarkdownIt from 'markdown-it';
import {
  normalizeWorkspacePath,
  withinWorkspacePath,
  workspacePathKey,
} from '../../app/shared/workspacePaths';

const parser = new MarkdownIt({ html: false });
export interface WorkspaceHeading {
  level: number;
  text: string;
  line: number;
  anchor: string;
}
export interface WorkspaceLink {
  destination: string;
  start: number;
  end: number;
  line: number;
  image: boolean;
}

/** One parser supplies block/code boundaries, headings and Markdown destinations. */
export function parseWorkspaceMarkdown(source: string): {
  headings: WorkspaceHeading[];
  links: WorkspaceLink[];
} {
  const offsets = [0];
  for (let i = 0; i < source.length; i++)
    if (source[i] === '\n') offsets.push(i + 1);
  const tokens = parser.parse(source, {});
  const mask = source.split('');
  for (const token of tokens) {
    if (['fence', 'code_block', 'html_block'].includes(token.type) && token.map)
      for (
        let i = offsets[token.map[0]];
        i < (offsets[token.map[1]] ?? source.length);
        i++
      )
        if (mask[i] !== '\n') mask[i] = ' ';
  }
  // Inline-code spans can contain arbitrary fake links, including newlines.
  const blocks = mask.join('');
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === '\\') {
      i++;
      continue;
    }
    if (mask[i] !== '`') continue;
    let end = i;
    while (mask[end] === '`') end++;
    const marker = '`'.repeat(end - i);
    let close = blocks.indexOf(marker, end);
    while (
      close >= 0 &&
      (mask[close - 1] === '`' || mask[close + marker.length] === '`')
    )
      close = blocks.indexOf(marker, close + marker.length);
    if (close >= 0) {
      for (let p = i; p < close + marker.length; p++)
        if (mask[p] !== '\n') mask[p] = ' ';
      i = close + marker.length - 1;
    } else i = end - 1;
  }
  const visible = mask.join('');
  const headings: WorkspaceHeading[] = [];
  const anchors = new Map<string, number>();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== 'heading_open') continue;
    const inline = tokens[i + 1];
    const text = (inline.children ?? [])
      .filter((child) => ['text', 'code_inline', 'image'].includes(child.type))
      .map((child) => child.content)
      .join('');
    const slug = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_\s-]/gu, '')
      .replace(/\s/g, '-');
    const count = anchors.get(slug) ?? 0;
    anchors.set(slug, count + 1);
    headings.push({
      level: Number(token.tag.slice(1)),
      text,
      line: (token.map?.[0] ?? 0) + 1,
      anchor: slug + (count ? `-${count}` : ''),
    });
  }
  const links: WorkspaceLink[] = [];
  const lineAt = (offset: number) => {
    let low = 0,
      high = offsets.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (offsets[mid] <= offset) low = mid + 1;
      else high = mid;
    }
    return low;
  };
  const destination = (position: number, image: boolean): number => {
    while (/\s/.test(source[position] ?? '') && position < source.length)
      position++;
    const parsed = parser.helpers.parseLinkDestination(
      source,
      position,
      source.length,
    );
    if (!parsed.ok) return position;
    const angle = source[position] === '<';
    const start = position + (angle ? 1 : 0),
      end = parsed.pos - (angle ? 1 : 0);
    links.push({
      destination: parsed.str,
      start,
      end,
      line: lineAt(start),
      image,
    });
    return parsed.pos;
  };
  // Reference definitions are the writable destination for both full and collapsed references.
  const definitions = /^ {0,3}\[[^\]\n]+\]:[ \t]*/gm;
  let match: RegExpExecArray | null;
  while ((match = definitions.exec(visible)))
    destination(match.index + match[0].length, false);
  for (let i = 0; i < visible.length; i++) {
    if (visible[i] === '\\') {
      i++;
      continue;
    }
    const image = visible[i] === '!' && visible[i + 1] === '[';
    const start = image ? i + 1 : i;
    if (visible[start] !== '[') continue;
    let depth = 1,
      close = start + 1;
    for (; close < visible.length && depth; close++) {
      if (visible[close] === '\\') {
        close++;
        continue;
      }
      if (visible[close] === '[') depth++;
      if (visible[close] === ']') depth--;
    }
    if (!depth && visible[close] === '(') {
      const count = links.length;
      const last = destination(close + 1, image);
      const ending = source
        .slice(last)
        .match(
          /^[\s]*(?:(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^)\\]|\\.)*\))[\s]*)?\)/,
        );
      if (!ending) {
        links.length = count;
        continue;
      }
      i = Math.max(close, last + ending[0].length - 1);
    }
  }
  return { headings, links: links.sort((a, b) => a.start - b.start) };
}

export function internalLinkTarget(
  document: string,
  destination: string,
): { path: string; suffix: string; anchor: string } | null {
  if (!destination || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(destination))
    return null;
  const split = destination.search(/[?#]/);
  const pathname = split < 0 ? destination : destination.slice(0, split);
  const suffix = split < 0 ? '' : destination.slice(split);
  let decoded: string, anchor: string;
  try {
    decoded = decodeURIComponent(pathname).replace(
      /\\([!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~])/g,
      '$1',
    );
    anchor = decodeURIComponent(suffix.split('#')[1] ?? '');
  } catch {
    return null;
  }
  const slash = document.replace(/\\/g, '/');
  return {
    path: pathname
      ? normalizeWorkspacePath(
          decoded.startsWith('/')
            ? decoded
            : slash.slice(0, slash.lastIndexOf('/') + 1) + decoded,
        )
      : document,
    suffix,
    anchor,
  };
}

export function remapWorkspacePath(
  path: string,
  oldPath: string,
  newPath: string,
): string {
  if (!withinWorkspacePath(path, oldPath)) return path;
  return (
    normalizeWorkspacePath(newPath) +
    normalizeWorkspacePath(path).slice(normalizeWorkspacePath(oldPath).length)
  );
}

function relativeLink(from: string, target: string): string {
  const a = normalizeWorkspacePath(from).split('/').slice(0, -1),
    b = normalizeWorkspacePath(target).split('/');
  while (
    a.length &&
    b.length &&
    workspacePathKey(a[0]) === workspacePathKey(b[0])
  ) {
    a.shift();
    b.shift();
  }
  return [...a.map(() => '..'), ...b]
    .map((segment) =>
      segment === '..'
        ? segment
        : encodeURIComponent(segment)
            .replace(/'/g, '%27')
            .replace(/\(/g, '%28')
            .replace(/\)/g, '%29'),
    )
    .join('/');
}

/** Updates inbound targets and rebases outbound links in moved documents. */
export function rewriteWorkspaceLinks(
  source: string,
  document: string,
  oldPath: string,
  newPath: string,
): { content: string; matches: number; path: string } {
  const newDocument = remapWorkspacePath(document, oldPath, newPath);
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  for (const link of parseWorkspaceMarkdown(source).links) {
    if (link.destination.startsWith('#')) continue;
    const target = internalLinkTarget(document, link.destination);
    if (!target) continue;
    const remapped = remapWorkspacePath(target.path, oldPath, newPath);
    if (
      workspacePathKey(remapped) === workspacePathKey(target.path) &&
      workspacePathKey(newDocument) === workspacePathKey(document)
    )
      continue;
    const text =
      (link.destination.startsWith('/')
        ? encodeURI(remapped)
        : relativeLink(newDocument, remapped)) + target.suffix;
    if (text !== source.slice(link.start, link.end))
      replacements.push({ start: link.start, end: link.end, text });
  }
  let content = source;
  for (const replacement of replacements.reverse())
    content =
      content.slice(0, replacement.start) +
      replacement.text +
      content.slice(replacement.end);
  return { content, matches: replacements.length, path: newDocument };
}
