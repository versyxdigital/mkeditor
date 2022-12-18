const { dialog } = require('electron')
const fs = require('fs')

const saveChangesToExisting = async () => {
    const check = await dialog.showMessageBox(null, {
        type: 'question',
        buttons: ['Yes', 'No'],
        title: 'Save changes',
        message: 'Would you like to save changes to your existing file first?'
    })

    return check.response === 0
}

const setActiveFile = (win, filepath = null) => {
    const filename = filepath ? filepath.split('\\').slice(-1).pop() : ''
    const content = filepath ? fs.readFileSync(filepath, { encoding: 'utf-8' }) : ''

    win.send('from:request:open', {
        filepath,
        filename,
        content
    })
}


module.exports = {
    async newFile(win, {data, file, encoding = 'utf-8'}) {
        const check = await saveChangesToExisting()
        if (check) {
            await this.save(win, {
                id: 'new',
                data,
                existingFilepath: file,
                encoding,
                reset: true
            })
        }

        setActiveFile(win.webContents, null, '')
    },
    async save(win, {id, data, existingFilepath = null, encoding = 'utf-8', reset = false}) {
        let options = {
            title: 'Save file',
            defaultPath : `markdown-${id}`,
            buttonLabel : 'Save',

            filters :[
                {name: 'md', extensions: ['md']},
                {name: 'All Files', extensions: ['*']}
            ]
        }

        if (existingFilepath) {
            let check

            try {
                check = fs.statSync(existingFilepath)
            } catch (error) {
                check = error.code || error
            }

            if (check !== 'ENOENT') {
                try {
                    fs.writeFileSync(existingFilepath, data, encoding)

                    win.webContents.send('from:notification:display', {
                        status: 'success',
                        message: 'File saved.'
                    })

                    setActiveFile(win.webContents, existingFilepath)
                } catch (error) {
                    win.webContents.send('from:notification:display', {
                        status: 'error',
                        message: `Unable to save file, please check ${existingFilepath}`
                    })
                }
            } else {
                win.webContents.send('from:notification:display', {
                    status: 'error',
                    message: `Unable to save file, please check ${existingFilepath}.`
                })
            }
        } else {
            dialog.showSaveDialog(null, options).then(({ filePath }) => {
                try {
                    fs.writeFileSync(filePath, data, encoding)

                    win.webContents.send('from:notification:display', {
                        status: 'success',
                        message: 'File saved.'
                    })

                    if (reset) {
                        filePath = null
                    }

                    setActiveFile(win.webContents, filePath)
                } catch (error) {
                    if (error.code !== 'ENOENT') {
                        win.webContents.send('from:notification:display', {
                            status: 'error',
                            message: 'An error has occurred, please try again.'
                        })
                    }
                }
            }).catch(() =>{
                win.webContents.send('from:notification:display', {
                    status: 'error',
                    message: 'An error has occurred, please try again.'
                })
            })
        }
    },

    async open(win) {
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
                    throw new Error('noselection')
                }

                let content = fs.readFileSync(filePaths[0], {
                    encoding: 'utf-8'
                })

                let filename = filePaths[0].split('\\').slice(-1).pop()

                return resolve({
                    filepath: filePaths[0],
                    filename,
                    content
                })
            }).catch((error) => {
                console.log(error.code)
                if (error.message !== 'noselection') {
                    win.webContents.send('from:notification:display', {
                        status: 'error',
                        message: 'Unable to open file.'
                    })   
                }
            })
        })
    }
}