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

### LineNumber
[`LineNumber.ts`](./renderer/LineNumber.ts) - Adds line number metadata to rendered markdown elements to support features like scroll sync.

### ImageStyle
[`ImageStyle.ts`](./renderer/ImageStyle.ts) - Adds Bootstrap classes to images for responsive behavior. By default adds `img-fluid` class to all images.

### LinkTarget 
[`LinkTarget.ts`](./renderer/LinkTarget.ts) - Modifies external links to open in new tabs by adding `target="_blank"` attribute.

### TableStyle
[`TableStyle.ts`](./renderer/TableStyle.ts) - Adds Bootstrap classes to tables for styling. Default classes:
- `table`
- `table-sm` 
- `table-bordered`
- `table-striped`

## Editor Extensions

These extensions add functionality to the Monaco editor:

### ScrollSync
[`ScrollSync.ts`](./editor/ScrollSync.ts) - Synchronizes scrolling between the editor and preview panes. Depends on the `LineNumber` extension to provide line number metadaa in the preview for tracking.

### WordCount 
[`WordCount.ts`](./editor/WordCount.ts) - Tracks and displays word and character counts for the current document.