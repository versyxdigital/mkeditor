const wordCount = (preview) => {
    let count = countWords(getTextInElement(preview));

    if (count < 0) {
        count = 0;
    }

    document.querySelector('#word-count').innerText = count;
};

const characterCount = (preview) => {
    let count = countCharacters(getTextInElement(preview)) - 1;

    if (count < 0) {
        count = 0;
    }

    document.querySelector('#character-count').innerText = count;
};

function countCharacters (str) {
    return str.length;
}

function countWords (str) {
    const words = str.replace(/W+/g, ' ').match(/\S+/g);
    return words && (words.length || 0);
}

function getTextInElement (node) {
    let text;

    if (node.nodeType === 3) {
        return node.data;
    }

    text = '';

    if (node.firstChild) {
        node = node.firstChild;
        while (true) {
            text += getTextInElement(node);

            if (!(node.nextSibling)) {
                break;
            }

            node = node.nextSibling;
        }
    }

    return text;
}

export { wordCount, characterCount };
