const config = require('../config/installer')
const { createWindowsInstaller } = require('electron-winstaller')

getInstallerConfig()
    .then(createWindowsInstaller)
    .catch((error) => {
        console.error(error.message || error)
        process.exit(1)
    })

function getInstallerConfig () {
    console.log('Creating windows installer...')
    return Promise.resolve(config)
}