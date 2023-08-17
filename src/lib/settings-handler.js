const os = require('os');
const fs = require('fs');
const path = require('path');

module.exports = class SettingsHandler
{
  path = null;
  file = null;

  constructor () {
    this.path = path.normalize(os.homedir() + '/.mkeditor/');
  }

  loadSettingsFile() {
    const file = fs.readFileSync(this.path + 'settings.json', {
      encoding: 'utf-8'
    });

    return JSON.parse(file);
  }

  saveSettingsToFile() {}
}