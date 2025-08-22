[![Tests](https://github.com/versyxdigital/mkeditor/actions/workflows/tests.yml/badge.svg)](https://github.com/versyxdigital/mkeditor/actions/workflows/tests.yml) &nbsp;&nbsp;&nbsp;&nbsp;[![CodeQL](https://github.com/versyxdigital/mkeditor/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/versyxdigital/mkeditor/actions/workflows/github-code-scanning/codeql)

# MKEditor

The simple markdown editor.

| Platform    | Stable  | Download  |
| --------    | ------- | -------   |
| Windows     | v3.3.0  | [exe](https://github.com/versyxdigital/mkeditor/releases/download/v3.3.0/mkeditor-setup-3.3.0.exe) |
| MacOS       | v3.3.0  | [pkg](https://github.com/versyxdigital/mkeditor/releases/download/v3.3.0/mkeditor-setup-3.3.0.pkg) |
| Linux       | v3.3.0  | [deb](https://github.com/versyxdigital/mkeditor/releases/download/v3.3.0/mkeditor-setup-3.3.0.deb)  |

Use it through your [browser](https://versyxdigital.github.io/mkeditor/web/) or download for desktop. More documentation is available at the [website](https://versyxdigital.github.io/mkeditor).

![MKEditor](https://versyxdigital.github.io/mkeditor/assets/demo-dark.png)
![MKEditor](https://versyxdigital.github.io/mkeditor/assets/demo.png)

# Welcome

Thank you for choosing MKEditor 😊, I hope you find this tool useful for all your markdown needs!

If you have any issues or questions, please feel free to submit an [issue](https://github.com/versyxdigital/mkeditor/issues).

---

Open the help menu using the button at the top right for a complete list of editor shortcuts.

You can also view a cheatsheet [here](https://versyxdigital.github.io/mkeditor/shortcuts).

---

MKEditor fully supports the [CommonMark](https://commonmark.org/) spec and comes with a few additional goodies.

**Great** support for _custom_ styling with:

- Bootstrap
- Fontawesome
- Highlight.js

Create alerts:

```md
::: primary
✨ Create alerts
:::
```

Format some code:

```javascript
document.addEventListener('DOMContentLoaded', () => {
    document.body.write('Syntax-highlighted codeblock!')
})
```

MKEditor also includes a built-in, resizable preview renderer and support for exporting your markdown to HTML, with or without styles 🚀.

Customize your settings, switch between light mode and dark mode, write some documents and have fun!

Built with ❤️ by [Versyx Digital](https://github.com/versyxdigital)

## Building from Source

If you would like to build from source, please follow the steps below:

1. Clone the repository
    ```sh
    git clone git@github.com:versyxdigital/mkeditor.git
    ```

2. Install dependencies
    ```sh
    npm install
    ```

3. Build the editor:
    ```sh
    npm run build-editor
    ```
      - This will output the editor to the **dist/** directory. You can serve the editor web app by running:
        ```
        npm run serve-web
        ```
        (requires [http-server](https://www.npmjs.com/package/http-server)).
4. Build the electron app:
    ```sh
    npm run build-app
    ```
      - This will output the app to the **dist/app/** directory. You can serve the electron app by running:
        ```
        npm run serve-app
        ```

To build an installable package:

```sh
npm run build-all
```

This will invoke the `make.mjs` script which runs all the necessary commands for building both an installer and an unpacked executable. Outputs to the **releases/** directory.

