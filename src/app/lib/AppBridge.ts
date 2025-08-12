import { BrowserWindow, dialog, ipcMain } from 'electron';
import { BridgedEditorContent } from '../interfaces/Bridge';
import { SettingsProviders } from '../interfaces/Providers';
import { AppStorage } from './AppStorage';

export class AppBridge {
  private context: BrowserWindow;

  private contextWindowTitle: string = 'MKEditor';

  private contextBridgedContent: BridgedEditorContent = {
    original: null,
    current: null,
  };

  private contextBridgedContentHasChanged: boolean = false;

  private providers: SettingsProviders = {
    settings: null,
  };

  constructor(context: BrowserWindow, register = false) {
    this.context = context;

    if (register) {
      this.register();
    }
  }

  provide<T>(provider: string, instance: T) {
    this.providers[provider] = instance;
  }

  register() {
    // Set the app window title
    ipcMain.on('to:title:set', (event, title = null) => {
      if (title) {
        this.contextWindowTitle = `MKEditor - ${title}`;
      }

      this.context.setTitle(this.contextWindowTitle);
    });

    // Set the editor state to track content changes in the main process.
    ipcMain.on('to:editor:state', (event, { original, current }) => {
      this.updateContextBridgedContent(original, current);
      this.context.setTitle(this.contextWindowTitle);
    });

    // Save editor settings to file (~/.mkeditor/settings.json)
    ipcMain.on('to:settings:save', (event, { settings }) => {
      this.providers.settings?.saveSettingsToFile(settings);
    });

    // Export rendered HTML, triggered from the renderer process
    ipcMain.on('to:html:export', (event, { content }) => {
      AppStorage.save(this.context, {
        id: event.sender.id,
        data: content,
        encoding: 'utf-8',
      });
    });

    // Create a new file, linked to the application menu
    ipcMain.on('to:file:new', () => {
      AppStorage.create(this.context).then(() => {
        this.resetContextBridgedContent();
      });
    });

    // Open a new file, forwarded from the renderer process
    // via received from:file:open event.
    ipcMain.on('to:file:open', () => {
      AppStorage.open(this.context);
    });

    ipcMain.on('to:folder:open', () => {
      AppStorage.openDirectory(this.context);
    });

    ipcMain.on('to:file:openpath', (event, { path }: { path: string }) => {
      AppStorage.openPath(this.context, path);
    });

    // Save an existing file, this is also used by the renderer bridge "from:file:open" listener, if
    // editor content changes are detected by logic in the renderer process, the renderer bridge will
    // submit a save event to this channel with prompt and fromOpen both defined, otherwise it'll just
    // submit an open event directly to the "to:file:open" channel instead.
    ipcMain.on(
      'to:file:save',
      async (
        event,
        {
          content,
          file,
          prompt = false,
          fromOpen = false,
          openPath = null,
          openFile = true,
        },
      ) => {
        if (await AppStorage.promptUserConfirmSave(this.context, prompt)) {
          AppStorage.save(this.context, {
            id: event.sender.id,
            data: content,
            filePath: file,
            encoding: 'utf-8',
            openFile,
          }).then(() => {
            if (openPath) AppStorage.openPath(this.context, openPath);
            else if (fromOpen) AppStorage.open(this.context);
            this.resetContextBridgedContent();
          });
        } else {
          if (openPath) AppStorage.openPath(this.context, openPath);
          else if (fromOpen) AppStorage.open(this.context);
        }
      },
    );

    // Save as event, doesn't require checks on "activeFile",
    // this will simply just call AppStorage save and triger
    // the dialog for the user to save the file to the location
    // of their choice.
    ipcMain.on('to:file:saveas', (event, data) => {
      AppStorage.save(this.context, {
        id: event.sender.id,
        data,
        encoding: 'utf-8',
      }).then(() => {
        this.resetContextBridgedContent();
      });
    });
  }

  promptUserBeforeQuit(event: Event) {
    if (this.contextBridgedContentHasChanged) {
      return this.displayPrompt(
        event,
        'Confirm',
        'You have unsaved changes, are you sure you want to quit?',
      );
    }
  }

  displayPrompt(event: Event, title: string, message: string) {
    const choice = dialog.showMessageBoxSync(this.context, {
      type: 'question',
      buttons: ['Yes', 'No'],
      title,
      message,
    });

    if (choice) {
      event.preventDefault();
    }
  }

  updateContextBridgedContent(original: string, current: string) {
    this.contextBridgedContent.original = original;
    this.contextBridgedContent.current = current;
    this.contextBridgedContentHasChanged = original !== current;
  }

  resetContextBridgedContent() {
    this.contextBridgedContent.original = null;
    this.contextBridgedContent.current = null;
    this.contextBridgedContentHasChanged = false;
  }
}
