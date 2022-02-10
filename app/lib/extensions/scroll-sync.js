const codeLineClass = 'has-line-data'

export function getEditorLineNumberForPreviewOffset(lineCount, preview) {
    const offset = preview.scrollTop
	const { previous, next } = getLineElementsAtPreviewOffset(offset, preview)
    
    if (previous) {
        const previousBounds = getElementBounds(previous)
        const offsetFromPrevious = (offset - preview.scrollTop - previousBounds.top)
        
        if (next) {
            const progressBetweenElements = offsetFromPrevious / (getElementBounds(next).top - previousBounds.top)
            const line = previous.line + progressBetweenElements * (next.line - previous.line)
            
            return clampLine(line, lineCount)
        } else {
            const progressWithinElement = offsetFromPrevious / (previousBounds.height)
            const line = previous.line + progressWithinElement
            
            return clampLine(line, lineCount)
        }
    }
    
    return null
}

export async function scrollPreviewToEditorVisibleRange(line, preview) {
    return new Promise((resolve) => {
        if (line <= 0) {
            preview.scroll(preview.scrollTop, 0)
            return
        }
        
        const { previous, next } = getElementsForSourceLine(line)
        
        if (!previous) {
            return
        }
        
        let scrollTo = 0
        const rect = getElementBounds(previous)
        const previousTop = rect.top
    
        if (next && next.line !== previous.line) {
            // Between two elements. Go to percentage offset between them.
            const betweenProgress = (line - previous.line) / (next.line - previous.line)
            const elementOffset = next.element.getBoundingClientRect().top - previousTop
            scrollTo = previousTop + betweenProgress * elementOffset
        } else {
            const progressInElement = line - Math.floor(line)
            scrollTo = previousTop + (rect.height * progressInElement)
        }
        
        scrollTo = Math.abs(scrollTo) < 1 ? Math.sign(scrollTo) : scrollTo
        preview.scroll(preview.scrollLeft, Math.max(1, preview.scrollTop + scrollTo))

        return resolve(preview)
    })
}

const getLineElementsAtPreviewOffset = (offset, preview) => {
    const lines = getCodeLineElements()
    const position = offset - preview.scrollTop
    
    let low = -1
    let high = lines.length - 1
	
    while (low + 1 < high) {
        const mid = Math.floor((low + high) / 2)
        const bounds = getElementBounds(lines[mid])
        
        if (bounds.top + bounds.height >= position) {
            high = mid
        } else {
            low = mid
        }
    }
    
    const highElement = lines[high]
    const highBounds = getElementBounds(highElement)
    
    if (high >= 1 && highBounds.top > position) {
        const lowElement = lines[low]

        return { previous: lowElement, next: highElement }
	}
    
    if (high > 1 && high < lines.length && highBounds.top + highBounds.height > position) {
        return { previous: highElement, next: lines[high + 1] }
    }
    
    return { previous: highElement }
}

const getElementsForSourceLine = (targetLine) => {
    const lineNumber = Math.floor(targetLine)
    const lines = getCodeLineElements()
    let previous = lines[0] || null
    
    for (const entry of lines) {
        if (entry.line === lineNumber) {
            return { previous: entry, next: undefined }
        } else if(entry.line > lineNumber) {
            return { previous, next: entry }
        }
        previous = entry
    }

    return { previous }
}

const getCodeLineElements = (() => {
    let elements
    
    return () => {
        elements = [{ element: document.body, line: 0 }]

        for (const element of document.getElementsByClassName(codeLineClass)) {
            const line = parseInt(element.getAttribute('data-line-start'))

            if (isNaN(line)) {
                continue   
            }

            if (element.tagName === 'CODE' && element.parentElement && element.parentElement.tagName === 'PRE') {
                // Fenced code blocks are a special case since the `code-line` can only be marked on
                // the `<code>` element and not the parent `<pre>` element.
                elements.push({ element: element.parentElement, line })
            } else {
                elements.push({ element, line })
            }
        }
        
        return elements
    }
})()

const getElementBounds = ({ element }) => {
    const myBounds = element.getBoundingClientRect()
    // Some code line elements may contain other code line elements.
    // In those cases, only take the height up to that child.
    const codeLineChild = element.querySelector(`.${codeLineClass}`)
    
    if (codeLineChild) {
        const childBounds = codeLineChild.getBoundingClientRect()
        const height = Math.max(1, (childBounds.top - myBounds.top))
        
        return {
            top: myBounds.top,
            height: height
        }
	}
    
    return myBounds
}

const clampLine = (line, lineCount) => {
    return clamp(0, lineCount - 1, line)
}

const clamp = (min, max, value) => {
    return Math.min(max, Math.max(min, value))
}