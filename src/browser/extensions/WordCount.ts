const WordCount = (preview: HTMLElement) => {
  let count = countWords(getTextInElement(preview));
  if (count && count < 0) count = 0;

  const wc = document.querySelector('#word-count');
  if (wc) wc.innerHTML = count?.toString() ?? '0';
};

const CharacterCount = (preview: HTMLElement) => {
  let count = countCharacters(getTextInElement(preview)) - 1;
  if (count && count < 0) count = 0;

  const cc = document.querySelector('#character-count');
  if (cc) cc.innerHTML = count?.toString() ?? '0';
};

function countCharacters(str: string) {
  return str.length;
}

function countWords(str: string) {
  const words = str.replace(/W+/g, ' ').match(/\S+/g);
  return words && (words.length || 0);
}

function getTextInElement(node: any) {
  let text;
  if (node.nodeType === 3) {
    return node.data;
  }

  text = '';

  if (node.firstChild) {
    node = node.firstChild;
    while (true) {
      text += getTextInElement(node);

      if (!node.nextSibling) {
        break;
      }
      node = node.nextSibling;
    }
  }

  return text;
}

export { WordCount, CharacterCount };
