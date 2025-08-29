import { dom } from '../../dom';

let lineElements: { element: HTMLElement; line: number }[] = [];
let needsRefresh = true;

const cacheLineElements = () => {
  lineElements = [{ element: document.body, line: 0 }];

  for (const element of document.getElementsByClassName(
    dom.meta.scroll.line.class,
  )) {
    const line = parseInt(
      <string>element.getAttribute(dom.meta.scroll.line.start),
    );

    if (isNaN(line)) {
      continue;
    }

    const node = element as HTMLElement;
    if (
      node.tagName === 'CODE' &&
      node.parentElement &&
      node.parentElement.tagName === 'PRE'
    ) {
      // Fenced code blocks are a special case since the `code-line` can only be marked on
      // the `<code>` element and not the parent `<pre>` element.
      lineElements.push({ element: node.parentElement, line });
    } else {
      lineElements.push({ element: node, line });
    }
  }
  needsRefresh = false;
};

const refreshLines = () => {
  needsRefresh = true;
};

const ScrollSync = async (line: number, preview: HTMLElement) => {
  return new Promise((resolve) => {
    if (line <= 0) {
      preview.scroll(preview.scrollLeft, 0);
      return resolve(preview);
    }

    const { previous, next } = getElementsForSourceLine(line);

    if (!previous) {
      return;
    }

    let scrollTo = 0;
    const rect = getElementBounds(previous);
    const previousTop = rect.top;

    if (next && next.line !== previous.line) {
      // Between two elements. Go to percentage offset between them.
      const betweenProgress =
        (line - previous.line) / (next.line - previous.line);
      const elementOffset =
        next.element.getBoundingClientRect().top - previousTop;
      scrollTo = previousTop + betweenProgress * elementOffset;
    } else {
      const progressInElement = line - Math.floor(line);
      scrollTo = previousTop + rect.height * progressInElement;
    }

    scrollTo = Math.abs(scrollTo) < 1 ? Math.sign(scrollTo) : scrollTo;
    preview.scroll(
      preview.scrollLeft,
      Math.max(1, preview.scrollTop + scrollTo),
    );

    // If we're at the top of the editor then force scroll top
    if (line === 1) preview.scroll({ top: 0 });

    // console.log({
    //   scrollTop: preview.scrollTop,
    //   scrollTo: scrollTo,
    //   currLine: line,
    //   nextLine: next?.line ?? null,
    // });

    return resolve(preview);
  });
};

const getElementsForSourceLine = (targetLine: number) => {
  const lineNumber = Math.floor(targetLine);
  const lines = getCodeLineElements();
  let previous = lines[0] || null;

  for (const entry of lines) {
    if (entry.line === lineNumber) {
      return { previous: entry, next: undefined };
    } else if (entry.line > lineNumber) {
      return { previous, next: entry };
    }
    previous = entry;
  }

  return { previous };
};

const getCodeLineElements = () => {
  if (needsRefresh) {
    cacheLineElements();
  }

  return lineElements;
};

const getElementBounds = ({ element }: { element: HTMLElement }) => {
  const bounds = element.getBoundingClientRect();
  // Some code line elements may contain other code line elements.
  // In those cases, only take the height up to that child.
  const child = element.querySelector(`.${dom.meta.scroll.line.class}`);

  if (child) {
    const childBounds = child.getBoundingClientRect();
    const height = Math.max(1, childBounds.top - bounds.top);

    return {
      top: bounds.top,
      height,
    };
  }

  return bounds;
};

export { ScrollSync, refreshLines };
