// Keep Monaco behind the managers' existing lazy import boundary. The package
// root imports every language, language-service worker, feature, and LSP client;
// editor.api lets MonacoWebpackPlugin select the features/languages we need.
// Monaco 0.57's metadata registers only transpose for caretOperations and only
// inline suggestions for suggest, so include the actual caret and completion
// controllers explicitly rather than relying on the package-root side effects.
import 'monaco-editor/editor/contrib/caretOperations/browser/caretOperations.js';
import 'monaco-editor/editor/contrib/suggest/browser/suggestController.js';
import 'monaco-editor/base/browser/ui/codicons/codicon/codicon-modifiers.css';
import { editor as monacoEditor } from 'monaco-editor/editor/editor.api';
import { StandaloneServices } from 'monaco-editor/editor/standalone/browser/standaloneServices.js';
import { IInstantiationService } from 'monaco-editor/platform/instantiation/common/instantiation.js';
import {
  IHoverService,
  WorkbenchHoverDelegate,
} from 'monaco-editor/platform/hover/browser/hover.js';
import { setHoverDelegateFactory } from 'monaco-editor/base/browser/ui/hover/hoverDelegateFactory.js';
import { setBaseLayerHoverDelegate } from 'monaco-editor/base/browser/ui/hover/hoverDelegate2.js';
import { IMarkdownRendererService } from 'monaco-editor/platform/markdown/browser/markdownRenderer.js';
import { EditorMarkdownCodeBlockRenderer } from 'monaco-editor/editor/browser/widget/markdownRenderer/browser/editorMarkdownCodeBlockRenderer.js';
import { WorkerBasedDocumentDiffProvider } from 'monaco-editor/editor/browser/widget/diffEditor/diffProviderFactoryService.js';

// Monaco 0.57's diff editors overwrite global UI factories with services owned
// by their inner editors. Once the diff is disposed, the next main-editor
// completion/tooltip can fail while creating its first row. Rebind those
// factories to the persistent standalone service container after construction.
const createDiffEditor = monacoEditor.createDiffEditor;
monacoEditor.createDiffEditor = (...args) => {
  try {
    return createDiffEditor(...args);
  } finally {
    const instantiationService = StandaloneServices.get(IInstantiationService);
    setHoverDelegateFactory((placement, instantHover) =>
      instantiationService.createInstance(
        WorkbenchHoverDelegate,
        placement,
        { instantHover },
        {},
      ),
    );
    setBaseLayerHoverDelegate(StandaloneServices.get(IHoverService));
    const markdownRenderer = StandaloneServices.get(IMarkdownRendererService);
    markdownRenderer.setDefaultCodeBlockRenderer(
      instantiationService.createInstance(EditorMarkdownCodeBlockRenderer),
    );
  }
};

// A worker may reject after a short-lived preview's models have been disposed.
// Monaco 0.57 only converts cancellation after a successful worker response,
// so these obsolete failures otherwise escape its async diff computation.
const computeDiff = WorkerBasedDocumentDiffProvider.prototype.computeDiff;
WorkerBasedDocumentDiffProvider.prototype.computeDiff = async function (
  ...args
) {
  const [original, modified, , token] = args;
  const obsolete = () =>
    token.isCancellationRequested ||
    original.isDisposed() ||
    modified.isDisposed();
  if (obsolete()) return null;
  try {
    const result = await computeDiff.apply(this, args);
    return obsolete() ? null : result;
  } catch (error) {
    if (obsolete()) return null;
    throw error;
  }
};

export * from 'monaco-editor/editor/editor.api';
