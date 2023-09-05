const os = require('os');
const fs = require('fs');
const path = require('path');

module.exports = class Settings {
    path = null;
    file = null;

    settings = {
        toggleAutoIndent: true,
        toggleDarkMode: false,
        toggleWordWrap: false,
        toggleWhitespace: false,
        toggleMinimap: true,
        showFoldingControls: false
    };

    constructor (context) {
        this.path = path.normalize(os.homedir() + '/.mkeditor/');
        this.file = this.path + 'settings.json';

        this.context = context;

        this.initSettingsFile();
    }

    loadSettingsFile () {
        const file = fs.readFileSync(this.file, {
            encoding: 'utf-8'
        });

        return JSON.parse(file);
    }

    initSettingsFile (settings = {}) {
        if (!fs.existsSync(this.path)) {
            fs.mkdirSync(this.path);
        }

        if (!fs.existsSync(this.file)) {
            settings = { ...this.settings, ...settings };
            this.saveSettingsToFile(settings, true);
        }
    }

    saveSettingsToFile (settings, init = false) {
        try {
            fs.writeFileSync(this.file, JSON.stringify(settings, null, 4), {
                encoding: 'utf-8'
            });

            if (!init) {
                this.context.webContents.send('from:notification:display', {
                    status: 'success',
                    message: 'Settings successfully updated.'
                });
            }
        } catch (error) {
            const message = error.code === 'EPERM'
                ? 'Unable to save settings: permission denied.'
                : 'Unable to save settings: unknown error.';

            this.context.webContents.send('from:notification:display', {
                status: 'error',
                message
            });
        }
    }
};
