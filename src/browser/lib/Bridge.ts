// import notify from '../utilities/notify';
import { editor } from 'monaco-editor/esm/vs/editor/editor.api';
import { ContextBridgeAPI, ContextBridgedFile } from '../interfaces/Bridge';
import { BridgeProviders, ValidModal } from '../interfaces/Providers';
import { EditorSettings } from '../interfaces/Editor';
import { EditorDispatcher } from '../events/EditorDispatcher';
import { Notify } from './Notify';
import { dom } from '../dom';

export class Bridge {

  private bridge: ContextBridgeAPI;

  private model: editor.IStandaloneCodeEditor;

  private dispatcher: EditorDispatcher;

  private activeFile: string | null = null;

  private contentHasChanged: boolean = false;
  
  public providers: BridgeProviders = {
    settings: null,
    commands: null,
    completion: null
  };

  constructor (
    bridge: ContextBridgeAPI,
    model: editor.IStandaloneCodeEditor,
    dispatcher: EditorDispatcher
  ) {
    this.bridge = bridge;
    this.model = model;
    this.dispatcher = dispatcher;
    
    this.register();

    this.dispatcher.addEventListener('editor:bridge:settings', (event) => {
      this.saveSettingsToFile(event.message);
    });
  }
  
  provide<T>(provider: string, instance: T) {
    this.providers[provider] = instance;
  }
  
  register () {
    // Set the theme according to the user's system theme
    this.bridge.receive('from:theme:set', (shouldUseDarkMode: boolean) => {
      if (shouldUseDarkMode) { 
        this.providers.settings?.setSetting('darkmode', shouldUseDarkMode);
        this.providers.settings?.setTheme();
        this.providers.settings?.setUIState();
      }
    });
    
    // Set settings from stored settings file (%HOME%/.mkeditor/settings.json)
    this.bridge.receive('from:settings:set', (settings: EditorSettings) => {
      this.loadSettingsFromStorageChannel(settings);
      this.providers.settings?.setSettings(settings);
      this.providers.settings?.registerDOMListeners();
    });
    
    // Enable new files from outside of the renderer execution context.
    // Provides access to browser window data and emits it to the ipc channel.
    this.bridge.receive('from:file:new', (channel: string) => {
      this.bridge.send('to:title:set', '');
      this.bridge.send(channel, {
        content: this.model.getValue(),
        file: this.activeFile
      });
    });
    
    // Enable saving files from outside of the renderer execution context.
    // Provides access to browser window data and emits it to the ipc channel.
    this.bridge.receive('from:file:save', (channel: string) => {
      this.bridge.send(channel, {
        content: this.model.getValue(),
        file: this.activeFile
      });
    });
    
    this.bridge.receive('from:file:saveas', (channel: string) => {
      this.bridge.send(channel, this.model.getValue());
    });
    
    // Enable opening files from outside of the renderer execution context.
    // If there are changes to the current file, user will be prompted and
    // the open event will be handled through this bridge channel's handler.
    this.bridge.receive('from:file:open', (channel: string) => {
      if (this.contentHasChanged) {
        this.bridge.send('to:file:save', {
          content: this.model.getValue(),
          file: this.activeFile,
          prompt: true,
          fromOpen: true
        });
      } else {
        this.bridge.send(channel, true);
      }
    });

    this.bridge.receive('from:file:opened', ({ content, filename, file }: ContextBridgedFile) => {
      this.model.focus();
      this.model.setValue(content);
      this.activeFile = file;
      
      // Dispatch contents so the editor can track it.
      this.dispatcher.setTrackedContent({
        content: this.model.getValue()
      });
      
      this.trackEditorStateBetweenExecutionContext(content, content);

      dom.meta.file.active.innerText = filename;
      
      this.bridge.send('to:title:set', filename === '' ? 'New File' : filename);
    });
    
    // Enable access to the monaco editor command palette.
    this.bridge.receive('from:command:palette', (command: string) => {
      this.model.focus();
      this.model.trigger(command, 'editor.action.quickCommand', {});
    });
    
    // Enable access to the monaco editor shortcuts modal.
    this.bridge.receive('from:modal:open', (modal: ValidModal) => {
      const handler = this.providers.commands?.getModal(modal);
      handler?.toggle();
    });
    
    // Enable notifications from the main context.
    this.bridge.receive('from:notification:display', (event: { status: string, message: string }) => {
      Notify.send(event.status, event.message);
    });
  }
  
  saveSettingsToFile (settings: EditorSettings) {
    this.bridge.send('to:settings:save', { settings });
  }
  
  saveContentToFile () {
    if (this.activeFile) {
      this.bridge.send('to:file:save', {
        content: this.model.getValue(),
        file: this.activeFile
      });
    } else {
      this.bridge.send('to:file:saveas', this.model.getValue());
    }
  }
  
  exportPreviewToFile (content: string) {
    this.bridge.send('to:html:export', { content });
  }
  
  trackEditorStateBetweenExecutionContext (original: string, current: string) {
    this.bridge.send('to:editor:state', { original, current });
    this.contentHasChanged = original !== current;
  }
  
  loadSettingsFromStorageChannel (settings: EditorSettings) {
    this.model.updateOptions({
      autoIndent: settings.autoindent ? 'advanced' : 'none'
    });
    
    this.model.updateOptions({
      wordWrap: settings.wordwrap ? 'on' : 'off'
    });
    
    this.model.updateOptions({
      renderWhitespace: settings.whitespace ? 'all' : 'none'
    });
    
    this.model.updateOptions({
      minimap: { enabled: settings.minimap }
    });
  }
}
