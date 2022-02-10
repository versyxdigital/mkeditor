### Development

1. Install the dependencies

```sh
npm install
```

2. Build the application

```sh
npm run build
```

3. Create application executable

```sh
npm run make:all
```

At this point, you should have a folder in your `out/` directory named `mkeditor-x64/`.

You can now open `mkeditor.exe` to run the application.

4. (optional - for Windows) Create Windows installer

```sh
node package/installer.js
```

This will create a new folder named `windows-installer` in the `out/` directory.

You can now open `mkeditor_setup.exe` to run the installer and install MKEditor.