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
            this.saveSettingsToFile(settings);
        }
    }

    saveSettingsToFile (settings) {
        try {
            fs.writeFileSync(this.file, JSON.stringify(settings, null, 4), {
                encoding: 'utf-8'
            });
        } catch (error) {
            if (error.code === 'EPERM') {
                // Notify user that permissions has changed on the settings file
                // On Windows, this could be due to making the directory and all children hidden.
            }
        }
    }
};
