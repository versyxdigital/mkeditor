# MKEditor Extensions

This folder contains extensions for markdown-it and editor functionality used in MKEditor.

## Markdown-it Extensions

The following extensions rely on markdown-it's rendering capabilities:

### AlertBlock
[`AlertBlock.ts`](./renderer/AlertBlock.ts) - Adds support for Bootstrap-styled alert blocks using container syntax:

```markdown
::: info
This is an info alert
:::
```

### ImageStyle
[`ImageStyle.ts`](./renderer/ImageStyle.ts) - Adds Bootstrap classes to images for responsive behavior. By default adds `img-fluid` class to all images.

### TableStyle
[`TableStyle.ts`](./renderer/TableStyle.ts) - Adds Bootstrap classes to tables for styling. Default classes:
- `table`
- `table-sm` 
- `table-bordered`
- `table-striped`

### LinkTarget 
[`LinkTarget.ts`](./renderer/LinkTarget.ts) - Modifies external links to open in new tabs by adding `target="_blank"` attribute.

### LineNumber
[`LineNumber.ts`](./renderer/LineNumber.ts) - Adds line number metadata to rendered markdown elements to support features like scroll sync.

## Editor Extensions

These extensions add functionality to the Monaco editor:

### ScrollSync
[`ScrollSync.ts`](./editor/ScrollSync.ts) - Synchronizes scrolling between the editor and preview panes. Depends on the `LineNumber` extension to provide line number metadaa in the preview for tracking.

### WordCount 
[`WordCount.ts`](./editor/WordCount.ts) - Tracks and displays word and character counts for the current document.

## Building Extensions

### Writing Custom Markdown-It Extensions

MKEditor uses [markdown-it](https://github.com/markdown-it/markdown-it) as its core Markdown parser. One of the most powerful ways to extend MKEditor is by hooking into markdown-it’s **renderer rules**.

This allows you to intercept the rendering of specific token types (such as `image`, `link_open`, `heading_open`, etc.) and modify attributes, inject new markup, or change the output entirely.

#### General Pattern for Custom Renderer Extensions

1. **Pick the rule** you want to extend.
   Common ones include:

   * `image`
   * `link_open`
   * `heading_open`
   * `paragraph_open`
   * `code_block`

2. **Capture the default renderer**:

   ```ts
   const defaultRender = md.renderer.rules.ruleName ||
     ((tokens, idx, opts, env, self) => self.renderToken(tokens, idx, opts));
   ```

3. **Override the rule**:

   ```ts
   md.renderer.rules.ruleName = (tokens, idx, opts, env, self) => {
     const token = tokens[idx];
     // Modify token attributes or content here
     return defaultRender(tokens, idx, opts, env, self);
   };
   ```

4. **Apply your extension** using `md.use()`.

#### Tips

* Always **call the default renderer** at the end unless you intend to completely replace the output.
* Use `token.attrJoin`, `token.attrSet`, or `token.attrPush` to safely manipulate attributes.
* Keep extensions modular (one concern per plugin) so they can be combined in different editor configurations.
* When possible, provide **options with defaults**, so extensions remain flexible but easy to use.

## Writing Monaco Editor Extensions in MKEditor

MKEditor is built on top of [Monaco Editor](https://microsoft.github.io/monaco-editor/), the same editor that powers VSCode.
You can extend Monaco with custom tools that listen to editor changes and provide real-time features such as **word count**, **character count**, or custom validations.

### Hooking into Monaco

To connect the extension to the editor:

```ts
import { CustomExtension } from './CustomExtension';

editor.onDidChangeModelContent(() => {
  CustomExtension(editor.getValue());
});
```

Whenever the user types, the editor content is passed into your extension functions.


#### General Pattern for Monaco Tools

1. **Define a tool function** that accepts the editor value (`string`) and performs some analysis or transformation.
2. **Subscribe to `onDidChangeModelContent`** so your tool runs on every edit.
3. **Update the UI** (DOM, status bar, or custom panel) with your results.
4. **Keep tools modular** - separate concerns into single-purpose functions (e.g. `WordCount`, `SpellCheck`, `Lint`).


#### Tips

* Use a **markdown stripper** if your feature should operate on plain text instead of raw Markdown.
* For performance-sensitive tools (like word count), debounce or throttle updates if you notice lag.
* You can register multiple tools - simply call each one inside the `onDidChangeModelContent` handler.
* Tools can also dispatch results into MKEditor’s own UI components, not just plain DOM nodes.