const path = require('path')
const { createWindowsInstaller } = require('electron-winstaller')

getInstallerConfig()
    .then(createWindowsInstaller)
    .catch((error) => {
        console.error(error.message || error)
        process.exit(1)
    })

function getInstallerConfig () {
    console.log('creating windows installer')

    return Promise.resolve({
        name: 'mkeditor',
        authors: 'Chris Rowles',
        appDirectory: path.join(__dirname, '../out/mkeditor-win32-x64'),
        outputDirectory: path.join(__dirname, '../out/windows-installer'),
        noMsi: true,
        exe: 'mkeditor.exe',
        setupExe: 'mkeditor-setup-x64.exe',
        iconUrl: path.join(__dirname, '../app/assets/logo.ico'),
        setupIcon: path.join(__dirname, '../app/assets/logo.ico'),
    })
}