import {
  ScrollSync,
  refreshLines,
} from '../src/browser/extensions/editor/ScrollSync';

function bounds(element: Element, top: number, height = 20) {
  element.getBoundingClientRect = jest.fn(() => ({
    top,
    height,
    left: 0,
    right: 100,
    bottom: top + height,
    width: 100,
    x: 0,
    y: top,
    toJSON() {},
  }));
}

function makePreview() {
  document.body.innerHTML =
    '<aside><p class="has-line-data" data-line-start="10">assistant</p></aside><div id="preview"><p id="first" class="has-line-data" data-line-start="10">first</p><p id="second" class="has-line-data" data-line-start="20">second</p></div>';
  const preview = document.querySelector<HTMLElement>('#preview')!;
  preview.scroll = jest.fn();
  preview.scrollTop = 40;
  bounds(preview, 100, 500);
  bounds(document.querySelector('aside p')!, 9000);
  bounds(document.querySelector('#first')!, 200);
  bounds(document.querySelector('#second')!, 400);
  return preview;
}

beforeEach(() => {
  refreshLines();
});

describe('document preview scroll mapping', () => {
  it('uses preview-relative coordinates and ignores assistant line markers', async () => {
    const preview = makePreview();
    expect(await ScrollSync(10, preview)).toBe(preview);
    expect(preview.scroll).toHaveBeenLastCalledWith(0, 140);
  });

  it('interpolates between the neighbouring source lines', async () => {
    const preview = makePreview();
    await ScrollSync(15, preview);
    expect(preview.scroll).toHaveBeenLastCalledWith(0, 240);
  });

  it('scrolls to zero for the beginning of a document', async () => {
    const preview = makePreview();
    await ScrollSync(1, preview);
    expect(preview.scroll).toHaveBeenCalledWith(0, 0);
  });

  it('refreshes when a different preview host replaces the old one', async () => {
    const original = makePreview();
    await ScrollSync(10, original);
    const replacement = makePreview();
    bounds(document.querySelector('#first')!, 300);
    await ScrollSync(10, replacement);
    expect(replacement.scroll).toHaveBeenLastCalledWith(0, 240);
  });

  it('settles harmlessly for unavailable previews or invalid line numbers', async () => {
    expect(await ScrollSync(10, null)).toBeNull();
    const preview = makePreview();
    await ScrollSync(Number.NaN, preview);
    expect(preview.scroll).not.toHaveBeenCalled();
  });
});
