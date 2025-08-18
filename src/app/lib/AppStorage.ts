import { app, BrowserWindow, dialog } from 'electron';
import { statSync, readFileSync, writeFileSync, promises as fs } from 'fs';
import { join } from 'path';
import { SaveFileOptions } from '../interfaces/Storage';

export class AppStorage {
  /** The active file path */
  private static activeFilePath: string | null = null;

  static getActiveFilePath() {
    return AppStorage.activeFilePath;
  }

  static async create(context: BrowserWindow) {
    AppStorage.setActiveFile(context, null);
  }

  static async promptUserConfirmSave(
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
      defaultPath: 'Untitled',
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
    try {
      const { filePaths } = await dialog.showOpenDialog({
        properties: ['openDirectory'],
      });

      if (filePaths.length === 0) {
        throw new Error('noselection');
      }

      const tree = await AppStorage.readDirectory(filePaths[0]);
      context.webContents.send('from:folder:opened', {
        path: filePaths[0],
        tree,
      });
      return tree;
    } catch (err) {
      if ((err as Error).message !== 'noselection') {
        context.webContents.send('from:notification:display', {
          status: 'error',
          message: 'Unable to open folder.',
        });
      }
    }
  }

  private static async readDirectory(dir: string): Promise<any[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const filtered = entries.filter(
      (d) => d.isDirectory() || d.name.endsWith('.md'),
    );
    return Promise.all(
      filtered.map(async (entry) => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          return {
            type: 'directory',
            name: entry.name,
            path: full,
            hasChildren: true,
          };
        }

        return { type: 'file', name: entry.name, path: full };
      }),
    );
  }

  static async openPath(context: BrowserWindow, filePath: string) {
    try {
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('invalidpath');
      }

      const stats = await fs.stat(filePath);
      if (stats.isDirectory()) {
        const tree = await AppStorage.readDirectory(filePath);
        context.webContents.send('from:folder:opened', {
          path: filePath,
          tree,
        });
      } else if (stats.isFile()) {
        AppStorage.setActiveFile(context, filePath);
      } else {
        throw new Error('unsupported');
      }
    } catch (err) {
      const code = (err as any)?.code || (err as Error).message;
      const message =
        code == 'EOENT' || code == 'invalidpath'
          ? 'The path does not exist.'
          : code == 'EACCESS'
            ? 'Permission denied, cannot open path.'
            : 'Unable to open path.';

      context.webContents.send('from:notification:display', {
        status: 'error',
        message,
      });
    }
  }

  static setActiveFile(context: BrowserWindow, file: string | null = null) {
    const filename = file ? file.split('\\').slice(-1).pop() : '';
    const content = file ? readFileSync(file, { encoding: 'utf-8' }) : '';

    AppStorage.activeFilePath = file;

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
