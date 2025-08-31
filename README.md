[![Tests](https://github.com/versyxdigital/mkeditor/actions/workflows/tests.yml/badge.svg)](https://github.com/versyxdigital/mkeditor/actions/workflows/tests.yml) &nbsp;&nbsp;&nbsp;&nbsp;[![CodeQL](https://github.com/versyxdigital/mkeditor/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/versyxdigital/mkeditor/actions/workflows/github-code-scanning/codeql)

# [MKEditor](https://versyxdigital.github.io/mkeditor)

Markdown with _style_.

| Platform    | Stable  | Download  |
| --------    | ------- | -------   |
| Windows     | v3.5.1  | [exe](https://github.com/versyxdigital/mkeditor/releases/download/v3.5.1/mkeditor-setup-3.5.1.exe) |
| MacOS       | v3.5.1  | [pkg](https://github.com/versyxdigital/mkeditor/releases/download/v3.5.1/mkeditor-setup-3.5.1.pkg) |
| Linux       | v3.5.1  | [deb](https://github.com/versyxdigital/mkeditor/releases/download/v3.5.1/mkeditor-setup-3.5.1.deb)  |

Download for desktop or use it directly through your [browser](https://versyxdigital.github.io/mkeditor/web/).

More documentation is available at the [website](https://versyxdigital.github.io/mkeditor).

<p>
    <img src="https://versyxdigital.github.io/mkeditor/assets/img/demo-dark.png" alt="MKEditor dark mode" width="45%" style="display:inline-block; margin-right:10px;" />
    <img src="https://versyxdigital.github.io/mkeditor/assets/img/demo.png" alt="MKEditor light mode" width="45%" style="display:inline-block;" />
</p>

# Welcome

Thank you for choosing MKEditor 😊, I hope you find this tool useful for all your markdown needs!

If you have any issues or questions, please feel free to submit an [issue](https://github.com/versyxdigital/mkeditor/issues).

MKEditor fully supports the [CommonMark](https://commonmark.org/) spec and comes with additional goodies.

## Great support for _custom_ styling

MKEditor comes with full support for styling your documents with:

- Bootstrap
- Fontawesome
- Highlight.js

### Create alerts

```sh
::: primary
✨ Create alerts
:::
```

![alerts](https://versyxdigital.github.io/assets/img/alerts.png)

### Format code

```javascript
document.addEventListener('DOMContentLoaded', () => {
    document.body.write('Syntax-highlighted codeblock!')
})
```

```php
$route = $app['router']->dispatch(
    $method,
    $request->getUri()->getPath()
);
```

```rust
if args[1] == "-h" || args[1] == "--help" {
    println!("{}", usage());
    return;
}
```

Syntax highlighting is supported for lots of languages, including but not limited to:

<p>
<img style="width: 35px;" src="https://code.visualstudio.com/assets/home/language-cpp.png">
<img style="width: 35px;" src="https://code.visualstudio.com/assets/home/language-cs.png">
<img style="width: 35px;" src="https://code.visualstudio.com/assets/home/language-php.png">
<img style="width: 35px;" src="https://code.visualstudio.com/assets/home/language-js.png">
<img style="width: 35px;" src="https://code.visualstudio.com/assets/home/language-ts.png">
<img style="width: 35px;" src="https://code.visualstudio.com/assets/home/language-python.png">
<img style="width: 35px;" src="https://code.visualstudio.com/assets/home/language-powershell.png">
</p>

### Write math

```sh
$\sqrt{3x-1}+(1+x)^2$
```

$\sqrt{3x-1}+(1+x)^2$

MKEditor comes with full support for writing expressions with LaTeX.

## Live Preview

MKEditor includes a fully configurable and resizable preview renderer. View your styled or unstyled output in real time. 👀

## Customizable Setings
Customize your settings, enable word-wrapping, toggle automatic indentation, switch between light or dark mode and more. 🌙

## Export to HTML & PDF

MKEditor comes with full support for exporting your markdown to HTML and PDF 🚀.

# Developer Documentation

## Building from source

If you would like to build from source, please follow the steps below:

1. Clone the repository
    ```sh
    git clone git@github.com:versyxdigital/mkeditor.git
    ```

2. Install dependencies
    ```sh
    npm install
    ```

To build just the editor:

```sh
npm run build-editor
```

To build just the electron app:

```sh
npm run build-app
```

To make an installable package (rebuilds both editor and app):

```sh
npm run make-installer
```

## Further Documentation 

MKEditor is split into two components: the browser-based renderer and the Electron desktop application. The browser renderer is a standalone web app, designed for markdown editing directly in the browser. The Electron app wraps the browser renderer, adding desktop-specific features such as file system access, native dialogs, and offline support.

- [Main process](./src/app/README.md): Documentation for the MKEditor electron app
- [Renderer](./src/browser/README.md): Documentation for the MKEditor web app

## AI Usage Policy

MKEditor occasionally uses [Codex](https://chatgpt.com/codex) as an **augmentative tool** for tasks such as generating documentation, boilerplate code, and expanding on **existing ideas**. This is strictly to speed up the development flow. All AI-assisted contributions are reviewed, verified, and refined manually before inclusion.


# License

MKEditor is open source software licensed under the [MIT License](./LICENSE).

Built with ❤️ by [Versyx Digital](https://github.com/versyxdigital)