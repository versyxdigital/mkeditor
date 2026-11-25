import { dom } from '../../dom';

interface LineElement {
  element: HTMLElement;
  line: number;
}

let lineElements: LineElement[] = [];
let cachedPreview: HTMLElement | null = null;
let needsRefresh = true;

const cacheLineElements = (preview: HTMLElement) => {
  lineElements = [{ element: preview, line: 0 }];
  // Assistant messages use the same Markdown renderer, but must never
  // participate in the document preview's scroll mapping.
  for (const element of preview.getElementsByClassName(
    dom.meta.scroll.line.class,
  )) {
    const line = Number.parseInt(
      element.getAttribute(dom.meta.scroll.line.start) ?? '',
      10,
    );
    if (!Number.isFinite(line) || line < 0) continue;
    const node = element as HTMLElement;
    lineElements.push({
      element:
        node.tagName === 'CODE' && node.parentElement?.tagName === 'PRE'
          ? node.parentElement
          : node,
      line,
    });
  }
  lineElements.sort((a, b) => a.line - b.line);
  cachedPreview = preview;
  needsRefresh = false;
};

const refreshLines = () => {
  needsRefresh = true;
  cachedPreview = null;
  lineElements = [];
};

const getElementsForSourceLine = (targetLine: number, preview: HTMLElement) => {
  if (needsRefresh || cachedPreview !== preview) cacheLineElements(preview);
  const line = Math.floor(targetLine);
  // Lower bound keeps lookup logarithmic on large documents and selects
  // the outermost element when nested tokens share a source line.
  let low = 0;
  let high = lineElements.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (lineElements[middle].line < line) low = middle + 1;
    else high = middle;
  }
  const next = lineElements[low];
  if (next?.line === line) return { previous: next, next: undefined };
  return { previous: lineElements[Math.max(0, low - 1)], next };
};

const getElementBounds = ({ element }: LineElement) => {
  const bounds = element.getBoundingClientRect();
  const child = element.querySelector(`.${dom.meta.scroll.line.class}`);
  if (child) {
    return {
      top: bounds.top,
      height: Math.max(1, child.getBoundingClientRect().top - bounds.top),
    };
  }
  return bounds;
};

const ScrollSync = async (line: number, preview: HTMLElement | null) => {
  if (!preview || !Number.isFinite(line)) return preview;
  if (line <= 1) {
    preview.scroll(preview.scrollLeft, 0);
    return preview;
  }

  const { previous, next } = getElementsForSourceLine(line, preview);
  const rect = getElementBounds(previous);
  let targetTop = rect.top;
  if (next && next.line !== previous.line) {
    const progress = (line - previous.line) / (next.line - previous.line);
    targetTop +=
      progress * (next.element.getBoundingClientRect().top - rect.top);
  } else {
    targetTop += rect.height * (line - Math.floor(line));
  }
  // Element rectangles are viewport-relative; the scroll offset must be
  // measured from the preview's own content edge, including its border.
  const previewTop = preview.getBoundingClientRect().top + preview.clientTop;
  preview.scroll(
    preview.scrollLeft,
    Math.max(0, preview.scrollTop + targetTop - previewTop),
  );
  return preview;
};

export { ScrollSync, refreshLines };
