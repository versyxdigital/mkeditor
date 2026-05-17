# Contributing to MKEditor

Contirbutions to MKEditor are welcomed. This document outlines how to build the project, coding standards, and the contribution process.

## Building from source

If you would like to build from source, please follow the steps below:

1. Clone the repository:

   ```sh
   git clone git@github.com:versyxdigital/mkeditor.git
   cd mkeditor
   ```

2. Install dependencies:

   ```sh
   npm install
   ```

   This also wires up the local Git pre-commit hook (via Husky's
   `prepare` script). The hook runs `npm run prettier-check`,
   `npm run lint`, and `npm test` before every commit; commits that
   fail any of the three are aborted. Use `git commit --no-verify`
   to bypass in an emergency, but expect CI to catch the same things.

3. Build targets:
   - Build just the editor:
     ```sh
     npm run build-editor
     ```
   - Build just the Electron app:
     ```sh
     npm run build-app
     ```
   - Build both editor and app, and create an installable package:
     ```sh
     npm run make-installer
     ```

## Project Structure

MKEditor is split into two main components:

- **Renderer (Browser)**  
  Built as a standalone web app for Markdown editing.  
  Documentation: [Renderer](./src/browser/README.md)

- **Electron Application (Desktop)**  
  Wraps the renderer, adding features such as file system access, dialogs, and offline support.  
  Documentation: [Main process](./src/app/README.md)

## Contribution Guidelines

### Branching

- Use feature branches for new work (`feature/<name>`).
- Use fix branches for bug fixes (`fix/<issue>`).
- Target `develop` for features and bug fixes.
- Keep `main` stable and production-ready.

### Commit Messages

- Follow the [Conventional Commits](https://www.conventionalcommits.org/) style:
  - `feat: add new toolbar button`
  - `fix: resolve crash when opening file`
  - `docs: update README`
  - `chore: bump dependency versions`

### Pull Requests

- Open PRs against the `main` branch.
- Fill out the [Pull Request Template](./.github/pull_request_template.md).
- Reference related issues using `Closes #<issue>` or `Related to #<issue>`.
- Ensure your PR is focused and not overloaded with unrelated changes.

### Code Standards

- Formatting is handled by Prettier (`npm run prettier-fix` writes,
  `npm run prettier-check` verifies). ESLint owns lint
  (`npm run lint`). Both run automatically in the pre-commit hook
  installed by `npm install`.
- Prefer readability over micro-optimizations.
- Write unit tests for new features or bug fixes when possible.
- Keep code consistent with the existing style.

## Testing

- Run the test suite before submitting a pull request:
  ```sh
  npm test
  ```
- The pre-commit hook runs the suite for you on every commit. The
  CI workflow (`.github/workflows/tests.yml`) re-runs the same
  checks plus `build-editor` and `build-app` to catch
  webpack/tsc errors that the unit tests miss.

## AI Usage Policy

MKEditor occasionally uses AI tools such as Codex and Claude as an **augmentative tool**.

- AI-generated content **must always be reviewed, verified, and refined manually** before inclusion.
- Core logic, architecture decisions, and final implementations **must always remain developer-driven**.

## Getting Help

- Open a [GitHub Discussion](https://github.com/versyxdigital/mkeditor/discussions) for design ideas or proposals.
- Use [GitHub Issues](https://github.com/versyxdigital/mkeditor/issues) for bug reports and feature requests.
- Tag maintainers in PRs when review is required.
