import {
  Markdown,
  renderAssistantMarkdown,
} from '../src/browser/core/Markdown';

describe('renderAssistantMarkdown (AI Assistant P4)', () => {
  it('escapes fenced-code language labels even when raw HTML is disabled', () => {
    const out = renderAssistantMarkdown(
      '```</span><img/src=x/onerror=alert(1)>\ntext\n```',
    );
    const document = new DOMParser().parseFromString(out, 'text/html');
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('.md-codeblock-lang')?.textContent).toBe(
      '</span><img/src=x/onerror=alert(1)>',
    );
  });

  it('escapes raw <script> tags from untrusted assistant content', () => {
    const out = renderAssistantMarkdown(
      'Look: <script>alert("xss")</script> and **bold**.',
    );
    // Tag escaped, not emitted as live HTML.
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
    // Markdown formatting still works inside the same call.
    expect(out).toContain('<strong>bold</strong>');
  });

  it('escapes raw inline HTML (img / iframe / onerror payloads)', () => {
    const out = renderAssistantMarkdown(
      '<img src=x onerror="alert(1)"> <iframe src="evil"></iframe>',
    );
    expect(out).not.toMatch(/<img\s/);
    expect(out).not.toMatch(/<iframe\s/);
    expect(out).toContain('&lt;img');
    expect(out).toContain('&lt;iframe');
  });

  it('restores the preview-side `html: true` after returning (no global mutation leak)', () => {
    expect(Markdown.options.html).toBe(true);
    renderAssistantMarkdown('<b>bold</b>');
    // After the assistant render the singleton's option is back to the
    // preview default; otherwise a subsequent PreviewPane render would
    // unexpectedly strip user-authored raw HTML.
    expect(Markdown.options.html).toBe(true);
  });

  it('still renders normal markdown features (lists, code fences)', () => {
    const out = renderAssistantMarkdown(
      '- item one\n- item two\n\n```ts\nconst x = 1;\n```',
    );
    expect(out).toContain('<ul>');
    // LineNumber extension annotates list items with class+data
    // attributes, so match content-only here rather than the exact tag.
    expect(out).toMatch(/<li[^>]*>item one<\/li>/);
    expect(out).toContain('hljs');
  });
});

describe('Markdown', () => {
  it('keeps fenced-code source line metadata on the codeblock wrapper', () => {
    const out = Markdown.render('paragraph\n\n```ts\nconst x = 1;\n```');
    const document = new DOMParser().parseFromString(out, 'text/html');
    const block = document.querySelector('.md-codeblock');
    expect(block?.classList.contains('has-line-data')).toBe(true);
    expect(block?.getAttribute('data-line-start')).toBe('3');
    expect(block?.getAttribute('data-line-end')).toBe('5');
  });

  it('treats inherited object property names as literal language labels', () => {
    const out = Markdown.render('```toString\ntext\n```');
    const document = new DOMParser().parseFromString(out, 'text/html');
    expect(document.querySelector('.md-codeblock-lang')?.textContent).toBe(
      'toString',
    );
  });

  it('round-trips large Unicode codeblock source for copying', () => {
    const source = '\u03bb\ud83d\ude80'.repeat(30000) + '\n';
    const out = Markdown.render('```unknown\n' + source + '```');
    const document = new DOMParser().parseFromString(out, 'text/html');
    const encoded = document
      .querySelector('.md-codeblock')!
      .getAttribute('data-source')!;
    expect(Buffer.from(encoded, 'base64').toString('utf8')).toBe(source);
  });

  it('initializes with extensions', () => {
    const output = Markdown.render(
      `::: info\n[test](http://example.com)\n:::\n\n![alt](img.png)\n\n|a|b|\n|-|-|\n|1|2|\n`,
    );
    expect(output).toContain('alert alert-info');
    expect(output).toContain('target="_blank"');
    expect(output).toContain('class="img-fluid"');
    expect(output).toContain(
      'class="table table-sm table-bordered table-striped"',
    );
  });

  it('adds line number data', () => {
    const output = Markdown.render('line1\n\nline2');
    expect(output).toContain('has-line-data');
  });

  it('renders latex expressions', () => {
    const output = Markdown.render('The area is $A = \\pi r^2$');
    expect(output).toContain('katex');
  });

  it('only auto-links explicit URLs', () => {
    const urlOutput = Markdown.render('http://example.com');
    expect(urlOutput).toContain('<a href="http://example.com"');

    const fileOutput = Markdown.render('hello.py');
    expect(fileOutput).not.toContain('<a');
  });
});
