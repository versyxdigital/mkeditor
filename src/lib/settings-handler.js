const os = require('os');
const fs = require('fs');
const path = require('path');

module.exports = class SettingsHandler
{
  path = null;
  file = null;

  settings = {
    toggleAutoIndent: false,
    toggleDarkMode: false,
    toggleWordWrap: true,
    toggleWhitespace: false,
  }

  constructor () {
    this.path = path.normalize(os.homedir() + '/.mkeditor/');
    this.file = this.path + 'settings.json';

    this.initSettingsFile();
  }

  loadSettingsFile() {
    const file = fs.readFileSync(this.file, {
      encoding: 'utf-8'
    });

    return JSON.parse(file);
  }

  initSettingsFile(settings = {}) {
    if (! fs.existsSync(this.path)) {
      fs.mkdirSync(this.path);
    }

    if (! fs.existsSync(this.file)) {
      settings = {...this.settings, ...settings};
      
      console.log({ settings });

      fs.writeFileSync(this.file, JSON.stringify(settings, null, 4), {
        encoding: 'utf-8'
      });
    }
  }

  saveSettingsToFile() {}
}