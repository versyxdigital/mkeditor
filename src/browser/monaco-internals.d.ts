// Monaco does not publish declarations for the internal services used by the
// 0.57 compatibility entry. Keep the boundary limited to the operations we use.
declare namespace MKEditorMonacoInternals {
  interface ServiceIdentifier<T> {
    readonly serviceType: T;
  }
  interface InstantiationService {
    createInstance(constructor: unknown, ...arguments_: unknown[]): unknown;
  }
  interface MarkdownRendererService {
    setDefaultCodeBlockRenderer(renderer: unknown): void;
  }
}

declare module 'monaco-editor/editor/standalone/browser/standaloneServices.js' {
  export const StandaloneServices: {
    get<T>(identifier: MKEditorMonacoInternals.ServiceIdentifier<T>): T;
  };
}

declare module 'monaco-editor/platform/instantiation/common/instantiation.js' {
  export const IInstantiationService: MKEditorMonacoInternals.ServiceIdentifier<MKEditorMonacoInternals.InstantiationService>;
}

declare module 'monaco-editor/platform/hover/browser/hover.js' {
  export const IHoverService: MKEditorMonacoInternals.ServiceIdentifier<unknown>;
  export const WorkbenchHoverDelegate: unknown;
}

declare module 'monaco-editor/base/browser/ui/hover/hoverDelegateFactory.js' {
  export function setHoverDelegateFactory(
    factory: (placement: 'mouse' | 'element', instant: boolean) => unknown,
  ): void;
}

declare module 'monaco-editor/base/browser/ui/hover/hoverDelegate2.js' {
  export function setBaseLayerHoverDelegate(delegate: unknown): void;
}

declare module 'monaco-editor/platform/markdown/browser/markdownRenderer.js' {
  export const IMarkdownRendererService: MKEditorMonacoInternals.ServiceIdentifier<MKEditorMonacoInternals.MarkdownRendererService>;
}

declare module 'monaco-editor/editor/browser/widget/markdownRenderer/browser/editorMarkdownCodeBlockRenderer.js' {
  export const EditorMarkdownCodeBlockRenderer: unknown;
}

declare module 'monaco-editor/editor/browser/widget/diffEditor/diffProviderFactoryService.js' {
  import type {
    CancellationToken,
    editor,
  } from 'monaco-editor/editor/editor.api';
  export class WorkerBasedDocumentDiffProvider {
    computeDiff(
      original: editor.ITextModel,
      modified: editor.ITextModel,
      options: unknown,
      token: CancellationToken,
    ): Promise<unknown>;
  }
}
