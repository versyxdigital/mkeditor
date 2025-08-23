import { app, dialog, type BrowserWindow } from 'electron';
import { statSync, readFileSync, writeFileSync, promises as fs } from 'fs';
import { join, dirname } from 'path';
import type { SaveFileOptions } from '../interfaces/Storage';

/**
 * AppStorage
 */
export class AppStorage {
  /** The active file path */
  private static activeFilePath: string | null = null;

  /**
   * Get the path to the active file
   * @returns - the active file path or null
   */
  static getActiveFilePath() {
    return AppStorage.activeFilePath;
  }

  /**
   * Set the active file.
   *
   * @param context
   * @param file
   * @returns
   */
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

  /**
   * Open the active file.
   *
   * @param context - the browser window
   * @param file - the file to open
   * @returns
   */
  static openActiveFile(context: BrowserWindow, file: string | null) {
    if (
      context &&
      file &&
      file !== '.' &&
      !file.startsWith('-') &&
      file.indexOf('MKEditor.lnk') === -1
    ) {
      AppStorage.setActiveFile(context, file);
    }
  }

  /**
   * Create a new file.
   *
   * @param context - the browser window
   */
  static async createNewFile(context: BrowserWindow) {
    AppStorage.setActiveFile(context, null);
  }

  /**
   * Save a file.
   *
   * @param context - the browser window
   * @param options - save file options
   * @returns
   */
  static async saveFile(context: BrowserWindow, options: SaveFileOptions) {
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

  /**
   * Show the open file dialog.
   *
   * @param context - the browser window
   * @returns
   */
  static async showOpenDialog(context: BrowserWindow) {
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

  /**
   * Open a folder/directory path.
   *
   * @param context - the browser window
   * @param filePath - the filepath
   * @returns
   */
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

  /**
   * Open a directory.
   *
   * @param context - the browser window
   * @returns
   */
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

  /**
   * Create a new empty file in the given directory.
   *
   * @param context - the browser window
   * @param parent - parent directory path
   * @param name - name of the new file
   */
  static async createFile(
    context: BrowserWindow,
    parent: string,
    name: string,
  ) {
    try {
      const file = join(parent, name);
      await fs.writeFile(file, '', 'utf-8');
      const tree = await AppStorage.readDirectory(parent);
      context.webContents.send('from:folder:opened', { path: parent, tree });
      context.webContents.send('from:notification:display', {
        status: 'success',
        message: 'File created.',
      });
    } catch {
      context.webContents.send('from:notification:display', {
        status: 'error',
        message: 'Unable to create file.',
      });
    }
  }

  /**
   * Create a new folder in the given directory.
   */
  static async createFolder(
    context: BrowserWindow,
    parent: string,
    name: string,
  ) {
    try {
      const dir = join(parent, name);
      await fs.mkdir(dir);
      const tree = await AppStorage.readDirectory(parent);
      context.webContents.send('from:folder:opened', { path: parent, tree });
      context.webContents.send('from:notification:display', {
        status: 'success',
        message: 'Folder created.',
      });
    } catch {
      context.webContents.send('from:notification:display', {
        status: 'error',
        message: 'Unable to create folder.',
      });
    }
  }

  /**
   * Rename a file or folder.
   */
  static async renamePath(context: BrowserWindow, path: string, name: string) {
    const parent = dirname(path);
    try {
      const newPath = join(parent, name);
      await fs.rename(path, newPath);
      const tree = await AppStorage.readDirectory(parent);
      context.webContents.send('from:folder:opened', { path: parent, tree });
      context.webContents.send('from:notification:display', {
        status: 'success',
        message: 'Renamed.',
      });
    } catch {
      context.webContents.send('from:notification:display', {
        status: 'error',
        message: 'Unable to rename.',
      });
    }
  }

  /**
   * Delete a file or folder.
   */
  static async deletePath(context: BrowserWindow, path: string) {
    const parent = dirname(path);
    try {
      await fs.rm(path, { recursive: true, force: true });
      const tree = await AppStorage.readDirectory(parent);
      context.webContents.send('from:folder:opened', { path: parent, tree });
      context.webContents.send('from:notification:display', {
        status: 'success',
        message: 'Deleted.',
      });
    } catch {
      context.webContents.send('from:notification:display', {
        status: 'error',
        message: 'Unable to delete.',
      });
    }
  }

  /**
   * Get properties of a file or folder.
   */
  static async getPathProperties(path: string) {
    const stats = await fs.stat(path);
    return {
      path,
      isDirectory: stats.isDirectory(),
      size: stats.size,
      created: stats.birthtime.toISOString(),
      modified: stats.mtime.toISOString(),
    };
  }

  /**
   * Read directory contents.
   *
   * @param dir - the directory to read
   * @returns - the directory contents
   */
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
}
