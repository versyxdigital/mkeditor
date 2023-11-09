// import notify from '../utilities/notify';
import { editor } from 'monaco-editor/esm/vs/editor/editor.api';
import { BridgeProviders, ContextBridgeAPI, ContextBridgedFile } from '../interfaces/Bridge';
import { EditorSettings } from '../interfaces/Editor';
import { EditorDispatcher } from '../events/EditorDispatcher';
import { Modal } from 'bootstrap';
import { dom } from '../dom';
import { Notify } from './Notify';

export class Bridge {

  private bridge: ContextBridgeAPI;

  private model: editor.IStandaloneCodeEditor;

  private dispatcher: EditorDispatcher;

  private activeFile: string | null = null;
  
  private providers: BridgeProviders = {
    settings: null,
    command: null
  };

  constructor (bridge: ContextBridgeAPI, model: editor.IStandaloneCodeEditor, dispatcher: EditorDispatcher, register = false) {
    this.bridge = bridge;
    this.model = model;
    this.dispatcher = dispatcher;
    
    if (register) {
      this.register();
    }

    this.dispatcher.addEventListener('editor:settings:bridge', (event) => {
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
        const icon = dom.icons.darkmode;
        icon.classList.remove('text-dark');
        icon.classList.add('text-warning');
        
        dom.settings.darkmode.checked = true;
        
        document.body.setAttribute('data-theme', 'dark');
        editor.setTheme('vs-dark');
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
    // Provides access to browser window data and emits it to the ipc channel.
    this.bridge.receive('from:file:open', ({ content, filename, file }: ContextBridgedFile) => {
      this.model.focus();
      this.model.setValue(content);
      this.activeFile = file;
      
      // Dispatch contents so the editor can track it.
      this.dispatcher.setState({
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
    this.bridge.receive('from:modal:open', (modal: string) => {
      type ModalCommand = keyof typeof this.providers.command;
      if (this.providers.command && this.providers.command[modal as ModalCommand]) {
        const handler = (this.providers.command[modal as ModalCommand] as Modal);
        handler.toggle();
      }
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
