import { app, BrowserWindow, dialog } from 'electron';
import { statSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { CreateFileOptions, SaveFileOptions } from '../interfaces/Storage';

export class AppStorage {
  static async create(context: BrowserWindow) {
    AppStorage.setActiveFile(context, null);
  }

  static async promptUserActionConfirmed(
    context: BrowserWindow,
    shouldShowPrompt = true,
  ) {
    if (!shouldShowPrompt) {
      return true;
    }

    const check = await dialog.showMessageBox(context, {
      type: 'question',
      buttons: ['Yes', 'No'],
      title: 'Save changes',
      message: 'Would you like to save changes to your existing file first?',
    });

    return check.response === 0;
  }

  static async save(context: BrowserWindow, options: SaveFileOptions) {
    const config = {
      title: 'Save file',
      defaultPath: `markdown-0${options.id}`,
      buttonLabel: 'Save',

      filters: [
        { name: 'md', extensions: ['md'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    };

    const isHTMLExport =
      options.data && options.data.startsWith('<!DOCTYPE html>');
    const errorAction = isHTMLExport
      ? 'Unable to export preview'
      : 'Unable to save markdown';
    const successAction = isHTMLExport
      ? 'Preview exported to HTML'
      : 'Markdown file saved';

    if (isHTMLExport) {
      config.filters.unshift({
        name: 'html',
        extensions: ['html'],
      });
      config.defaultPath = `export-0${options.id}`;
    }

    if (options.filePath) {
      let check;

      try {
        check = statSync(options.filePath);
      } catch (err) {
        const details = err as { code: string };
        check = details.code || err;
      }

      if (check !== 'ENOENT') {
        try {
          writeFileSync(options.filePath, options.data, options.encoding);

          context.webContents.send('from:notification:display', {
            status: 'success',
            message: successAction,
          });

          if (!isHTMLExport && options.openFile !== false) {
            AppStorage.setActiveFile(context, options.filePath);
          }
        } catch (err) {
          context.webContents.send('from:notification:display', {
            status: 'error',
            message: errorAction,
          });
        }
      } else {
        context.webContents.send('from:notification:display', {
          status: 'error',
          message: errorAction,
        });
      }
    } else {
      dialog
        .showSaveDialog(context, config)
        .then(({ filePath }) => {
          try {
            writeFileSync(<string>filePath, options.data, options.encoding);

            context.webContents.send('from:notification:display', {
              status: 'success',
              message: successAction,
            });

            if (!isHTMLExport && options.openFile !== false) {
              AppStorage.setActiveFile(context, filePath);
            }
          } catch (err: unknown) {
            const details = err as { code: string };
            if (details.code !== 'ENOENT') {
              context.webContents.send('from:notification:display', {
                status: 'error',
                message: 'An error has occurred, please try again.',
              });
            }
          }
        })
        .catch(() => {
          context.webContents.send('from:notification:display', {
            status: 'error',
            message: 'An error has occurred, please try again.',
          });
        });
    }
  }

  static async open(context: BrowserWindow) {
    return new Promise((resolve) => {
      dialog
        .showOpenDialog({
          filters: [
            { name: 'Text Files', extensions: ['html', 'md', 'txt'] },
            { name: 'All Files', extensions: ['*'] },
          ],
          properties: ['openFile'],
        })
        .then(({ filePaths }) => {
          if (filePaths.length === 0) {
            throw new Error('noselection');
          }

          const file = AppStorage.setActiveFile(context, filePaths[0]);

          return resolve({
            file: filePaths[0],
            filename: file.filename,
            content: file.content,
          });
        })
        .catch((err) => {
          if (err.message !== 'noselection') {
            context.webContents.send('from:notification:display', {
              status: 'error',
              message: 'Unable to open file.',
            });
          }
        });
    });
  }

  static async openDirectory(context: BrowserWindow) {
    return new Promise((resolve) => {
      dialog
        .showOpenDialog({ properties: ['openDirectory'] })
        .then(({ filePaths }) => {
          if (filePaths.length === 0) {
            throw new Error('noselection');
          }

          const tree = AppStorage.readDirectory(filePaths[0]);
          context.webContents.send('from:folder:opened', {
            path: filePaths[0],
            tree,
          });
          resolve(tree);
        })
        .catch((err) => {
          if (err.message !== 'noselection') {
            context.webContents.send('from:notification:display', {
              status: 'error',
              message: 'Unable to open folder.',
            });
          }
        });
    });
  }

  private static readDirectory(dir: string): any[] {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() || d.name.endsWith('.md'))
      .map((entry) => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          return {
            type: 'directory',
            name: entry.name,
            path: full,
            children: AppStorage.readDirectory(full),
          };
        }

        return { type: 'file', name: entry.name, path: full };
      });
  }

  static openPath(context: BrowserWindow, filePath: string) {
    AppStorage.setActiveFile(context, filePath);
  }

  static setActiveFile(context: BrowserWindow, file: string | null = null) {
    const filename = file ? file.split('\\').slice(-1).pop() : '';
    const content = file ? readFileSync(file, { encoding: 'utf-8' }) : '';

    if (file) app.addRecentDocument(file);

    context.webContents.send('from:file:opened', {
      file,
      filename,
      content,
    });

    return {
      filename,
      content,
    };
  }
}
