import { app, dialog, type BrowserWindow } from 'electron';
import { statSync, readFileSync, writeFileSync, promises as fs } from 'fs';
import { join, dirname } from 'path';
import type { SaveFileOptions } from '../interfaces/Storage';
import type { AppState } from './AppState';

/**
 * AppStorage
 */
export class AppStorage {
  /** The active file path */
  private static activeFilePath: string | null = null;

  private static state: AppState | null = null;

  /**
   * Set app state singleton.
   *
   * @param state instance of AppState
   */
  static setState(state: AppState) {
    this.state = state;
  }

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

    if (file) {
      app.addRecentDocument(file); // electorn native
      AppStorage.state?.addRecentPath(file, 'file'); // MKEditor
    }

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
      ? 'notifications:unable_export_preview'
      : 'notifications:unable_save_markdown';
    const successAction = isHTMLExport
      ? 'notifications:exported_html_success'
      : 'notifications:saved_markdown_success';

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
          writeFileSync(options.filePath, options.data, {
            encoding: options.encoding ?? 'utf-8',
          });

          context.webContents.send('from:notification:display', {
            status: 'success',
            key: successAction,
          });

          if (!isHTMLExport && options.openFile !== false) {
            AppStorage.setActiveFile(context, options.filePath);
          }
        } catch (err) {
          context.webContents.send('from:notification:display', {
            status: 'error',
            key: errorAction,
          });
        }
      } else {
        context.webContents.send('from:notification:display', {
          status: 'error',
          key: errorAction,
        });
      }
    } else {
      dialog
        .showSaveDialog(context, config)
        .then(({ filePath }) => {
          try {
            writeFileSync(<string>filePath, options.data, {
              encoding: options.encoding ?? 'utf-8',
            });

            context.webContents.send('from:notification:display', {
              status: 'success',
              key: successAction,
            });

            if (!isHTMLExport && options.openFile !== false) {
              AppStorage.setActiveFile(context, filePath);
            }
          } catch (err: unknown) {
            const details = err as { code: string };
            if (details.code !== 'ENOENT') {
              context.webContents.send('from:notification:display', {
                status: 'error',
                key: 'notifications:generic_error_try_again',
              });
            }
          }
        })
        .catch(() => {
          context.webContents.send('from:notification:display', {
            status: 'error',
            key: 'notifications:generic_error_try_again',
          });
        });
    }
  }

  /**
   * Save a file to PDF.
   *
   * @param context - the browser window
   * @param offscreen - the offscreen render window for the PDF
   * @param options - save file options
   * @returns
   */
  static async saveFileToPDF(
    context: BrowserWindow,
    offscreen: BrowserWindow,
    options: SaveFileOptions,
  ) {
    const defaultPath = `pdf-export-${options.id}`;
    offscreen.setTitle(defaultPath);

    await offscreen.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(options.data)}`,
    );

    await offscreen.webContents.executeJavaScript(`
      (async () => {
        await document.fonts?.ready;
        const images = Array.from(document.images).map(img =>
          img.complete ? Promise.resolve() :
          new Promise(res => { img.onload = img.onerror = () => res(); })
        );
        await Promise.all(images);
      })();
    `);

    const pdf = await offscreen.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
    });

    const { filePath } = await dialog.showSaveDialog(context, {
      filters: [{ name: defaultPath, extensions: ['pdf'] }],
      defaultPath: `${defaultPath}.pdf`,
    });

    if (!filePath) return;

    writeFileSync(filePath, pdf, {
      encoding: options.encoding ?? 'utf-8',
    });

    offscreen.destroy();
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
              key: 'notifications:unable_open_file',
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
        AppStorage.state?.addRecentPath(filePath, 'folder');
      } else if (stats.isFile()) {
        AppStorage.setActiveFile(context, filePath);
      } else {
        throw new Error('unsupported');
      }
    } catch (err) {
      const code = (err as any)?.code || (err as Error).message;
      const key =
        code == 'EOENT' || code == 'invalidpath'
          ? 'notifications:path_not_exist'
          : code == 'EACCESS'
            ? 'notifications:permission_denied_open_path'
            : 'notifications:unable_open_path';

      context.webContents.send('from:notification:display', {
        status: 'error',
        key,
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
          key: 'notifications:unable_open_folder',
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
        key: 'notifications:file_created',
      });
    } catch {
      context.webContents.send('from:notification:display', {
        status: 'error',
        key: 'notifications:unable_create_file',
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
        key: 'notifications:folder_created',
      });
    } catch {
      context.webContents.send('from:notification:display', {
        status: 'error',
        key: 'notifications:unable_create_folder',
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
      context.webContents.send('from:path:renamed', {
        oldPath: path,
        newPath,
        name,
      });
      context.webContents.send('from:notification:display', {
        status: 'success',
        key: 'notifications:renamed_success',
      });
    } catch {
      context.webContents.send('from:notification:display', {
        status: 'error',
        key: 'notifications:unable_rename',
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
        key: 'notifications:deleted_success',
      });
    } catch {
      context.webContents.send('from:notification:display', {
        status: 'error',
        key: 'notifications:unable_delete',
      });
    }
  }

  /**
   * Get properties of a file or folder.
   */
  static async getPathProperties(path: string) {
    const stats = await fs.stat(path);
    let size: string;
    if (stats.size >= 1024 * 1024) {
      size = `${(stats.size / (1024 * 1024)).toFixed(2)} MB`;
    } else {
      size = `${(stats.size / 1024).toFixed(2)} KB`;
    }

    return {
      path,
      isDirectory: stats.isDirectory(),
      size,
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
