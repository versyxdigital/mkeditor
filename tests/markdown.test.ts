import {
  Markdown,
  renderAssistantMarkdown,
} from '../src/browser/core/Markdown';

describe('renderAssistantMarkdown (AI Assistant P4)', () => {
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
