import { Markdown } from '../src/browser/core/Markdown';

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
});
