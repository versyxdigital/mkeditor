const ScrollSync = async (line: number, preview: HTMLElement) => {
  return new Promise((resolve) => {
    if (line <= 0) {
      preview.scroll(preview.scrollTop, 0);
      return;
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
      const betweenProgress = (line - previous.line) / (next.line - previous.line);
      const elementOffset = next.element.getBoundingClientRect().top - previousTop;
      scrollTo = previousTop + betweenProgress * elementOffset;
    } else {
      const progressInElement = line - Math.floor(line);
      scrollTo = previousTop + (rect.height * progressInElement);
    }
    
    scrollTo = Math.abs(scrollTo) < 1 ? Math.sign(scrollTo) : scrollTo;
    preview.scroll(preview.scrollLeft, Math.max(1, preview.scrollTop + scrollTo));
    
    return resolve(preview);
  });
};

const codeLineClass = 'has-line-data';

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

const getCodeLineElements = (() => {
  let elements;
  
  return () => {
    elements = [{ element: document.body, line: 0 }];
    
    for (const element of document.getElementsByClassName(codeLineClass)) {
      const line = parseInt(<string>element.getAttribute('data-line-start'));
      
      if (isNaN(line)) {
        continue;
      }

      const node = (element as HTMLElement);
      if (node.tagName === 'CODE' && node.parentElement && node.parentElement.tagName === 'PRE') {
        // Fenced code blocks are a special case since the `code-line` can only be marked on
        // the `<code>` element and not the parent `<pre>` element.
        elements.push({ element: node.parentElement, line });
      } else {
        elements.push({ element: node, line });
      }
    }
    
    return elements;
  };
})();

const getElementBounds = ({ element }: { element: HTMLElement }) => {
  const myBounds = element.getBoundingClientRect();
  // Some code line elements may contain other code line elements.
  // In those cases, only take the height up to that child.
  const codeLineChild = element.querySelector(`.${codeLineClass}`);
  
  if (codeLineChild) {
    const childBounds = codeLineChild.getBoundingClientRect();
    const height = Math.max(1, (childBounds.top - myBounds.top));
    
    return {
      top: myBounds.top,
      height
    };
  }
  
  return myBounds;
};

export {
  ScrollSync
};
