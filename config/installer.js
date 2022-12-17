const path = require('path')

module.exports = {
    name: 'mkeditor',
    authors: 'Chris Rowles',
    copyright: 'Copyright © Chris Rowles 2022. All Rights Reserved',
    
    /**
    * The folder path of the electron app
    */
    appDirectory: path.join(__dirname, '../out/mkeditor-win32-x64'),
    
    /**
    * The name of the electron app executable
    */
    exe: 'mkeditor.exe',
    
    /**
    * The folder path to create the .exe installer in
    */
    outputDirectory: path.join(__dirname, '../out/windows-installer'),
    
    /**
    * The name to use for the generated Setup.exe file
    */
    setupExe: 'mkeditor-setup-x64.exe',
    
    /**
    * Should Squirrel.Windows create an MSI installer?
    */
    noMsi: false,
    
    /**
    * The name to use for the generated Setup.msi file
    */
    setupMsi: 'mkeditor-setup-x64.msi',
    
    /**
    * A publicly accessible, fully qualified HTTP(S) URL to an ICO file, used as the application icon
    * displayed in Control Panel ➡ Programs and Features. The icon is retrieved at install time.
    * Example: http://example.com/favicon.ico
    *
    * Does not accept `file:` URLs.
    *
    * Defaults to the Electron icon.
    */
    iconUrl: 'https://mkeditoross.github.io/mkeditor/favicon.ico',
    
    
    /**
    * The ICO file to use as the icon for the generated setup
    */
    setupIcon: path.join(__dirname, '../app/assets/logo.ico'),
}