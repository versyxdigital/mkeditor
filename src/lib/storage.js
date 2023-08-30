const { dialog } = require('electron');
const fs = require('fs');

const saveChangesToExisting = async () => {
    const check = await dialog.showMessageBox(null, {
        type: 'question',
        buttons: ['Yes', 'No'],
        title: 'Save changes',
        message: 'Would you like to save changes to your existing file first?'
    });

    return check.response === 0;
};

module.exports = {
    async create (context, { data, file, encoding = 'utf-8' }) {
        const check = await saveChangesToExisting();
        if (check) {
            await this.save(context, {
                id: 'new',
                data,
                file,
                encoding,
                reset: true
            });
        }

        this.setActiveFile(context, null, '');
    },

    async save (context, { id, data, file = null, encoding = 'utf-8', reset = false }) {
        const options = {
            title: 'Save file',
            defaultPath: `markdown-${id}`,
            buttonLabel: 'Save',

            filters: [
                { name: 'md', extensions: ['md'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        };

        const isHTMLExport = data && data.startsWith('<!DOCTYPE html>');
        const errorAction = isHTMLExport ? 'Unable to export preview' : 'Unable to save markdown';
        const successAction = isHTMLExport ? 'Preview exported to HTML' : 'Markdown file saved';

        if (isHTMLExport) {
            options.filters.unshift({
                name: 'html',
                extensions: ['html']
            });

            options.defaultPath = `export-${id}`;
        }

        if (file) {
            let check;

            try {
                check = fs.statSync(file);
            } catch (error) {
                check = error.code || error;
            }

            if (check !== 'ENOENT') {
                try {
                    fs.writeFileSync(file, data, encoding);

                    context.webContents.send('from:notification:display', {
                        status: 'success',
                        message: successAction
                    });

                    if (!isHTMLExport) {
                        this.setActiveFile(context, file);
                    }
                } catch (error) {
                    context.webContents.send('from:notification:display', {
                        status: 'error',
                        message: errorAction
                    });
                }
            } else {
                context.webContents.send('from:notification:display', {
                    status: 'error',
                    message: errorAction
                });
            }
        } else {
            dialog.showSaveDialog(null, options)
                .then(({ filePath }) => {
                    try {
                        fs.writeFileSync(filePath, data, encoding);

                        context.webContents.send('from:notification:display', {
                            status: 'success',
                            message: successAction
                        });

                        if (reset) {
                            filePath = null;
                        }

                        if (!isHTMLExport) {
                            this.setActiveFile(context, filePath);
                        }
                    } catch (error) {
                        if (error.code !== 'ENOENT') {
                            context.webContents.send('from:notification:display', {
                                status: 'error',
                                message: 'An error has occurred, please try again.'
                            });
                        }
                    }
                })
                .catch(() => {
                    context.webContents.send('from:notification:display', {
                        status: 'error',
                        message: 'An error has occurred, please try again.'
                    });
                });
        }
    },

    async open (context) {
        return new Promise((resolve) => {
            dialog.showOpenDialog({
                filters: [
                    { name: 'Text Files', extensions: ['html', 'md', 'txt'] },
                    { name: 'All Files', extensions: ['*'] }
                ],
                properties: ['openFile']
            })
                .then(({ filePaths }) => {
                    if (filePaths.length === 0) {
                        throw new Error('noselection');
                    }

                    const content = fs.readFileSync(filePaths[0], {
                        encoding: 'utf-8'
                    });

                    const filename = filePaths[0].split('\\').slice(-1).pop();

                    return resolve({
                        file: filePaths[0],
                        filename,
                        content
                    });
                }).catch((error) => {
                    if (error.message !== 'noselection') {
                        context.webContents.send('from:notification:display', {
                            status: 'error',
                            message: 'Unable to open file.'
                        });
                    }
                });
        });
    },

    setActiveFile (context, file = null) {
        const filename = file ? file.split('\\').slice(-1).pop() : '';
        const content = file ? fs.readFileSync(file, { encoding: 'utf-8' }) : '';

        context.webContents.send('from:file:open', {
            file,
            filename,
            content
        });
    }
};
