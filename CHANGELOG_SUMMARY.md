# Changelog Summary

This document provides a high-level summary of MKEditor's development history, based on the full changelog.

---

## Overview

MKEditor has evolved significantly across its v3.x release cycle, growing from a basic multi-file editor into a feature-rich, cross-platform Markdown editing experience with a modern UI, web support, and broad localisation.

---

## Major Milestones

### 🗂️ Workspaces & File Management (v3.0.0 – v3.1.0)

The v3.x era began with the introduction of a **file tree explorer** and **workspace support**, allowing users to edit multiple files simultaneously. This was quickly followed by **tab reordering** and performance improvements to file tree and DOM rendering.

### 🐛 Stability & Bug Fixes (v3.0.1)

Shortly after the v3.0 launch, key bugs were addressed — including a layout issue with large images in the preview and an incorrectly triggered save prompt.

### ➕ LaTeX & Architecture Improvements (v3.2.0)

**LaTeX expression support** was added, and the internal bridge was refactored into a more modular structure.

### 🔄 Automatic Updates & Logging (v3.3.0 – v3.3.1)

The app gained **automatic update checking** via GitHub releases, and **application logging** was introduced using `electron-log`. Export optimisations were also made.

### 🖱️ File Explorer Context Menu (v3.4.0)

Desktop users gained a **right-click context menu** in the file explorer, supporting common file and folder operations.

### 🎨 Export & Preview Styling (v3.5.0 – v3.5.1)

A suite of **configurable HTML/PDF export styling options** was introduced, with settings persisted to the user's config file. Preview styling also became **live-updating** in response to export setting changes. A bug with non-links being rendered as links was also fixed.

### 🌍 Localisation & Web Persistence (v3.6.0)

MKEditor expanded its reach with support for **11 new languages** (German, Spanish, Italian, Dutch, Portuguese, Turkish, Russian, Ukrainian, Korean, Japanese, and Simplified Chinese). The web version also gained **local storage persistence**, so users can resume editing after a page reload.

### ⚛️ React UI Migration (v3.7.0)

A major internal overhaul migrated the UI from a direct-DOM approach to **React**, replaced Bootstrap with **Tailwind CSS**, and introduced a **GitHub-style live preview** theme.

### 💾 Session Persistence & Web File Explorer (v3.8.0 – v3.8.1)

The latest releases brought **workspace session persistence** (open tabs, active tab, and cursor/scroll positions restored on relaunch) across both desktop and web. The web version also gained a full **file explorer** powered by the File System Access API with IndexedDB persistence. Code blocks in the preview were enhanced with a **language label and copy button**, and shell/bash blocks render in a terminal style. Bug fixes addressed panel overflow issues and a splash screen hang on web.

---

## Summary of Key Themes

| Theme                       | Versions                       |
| --------------------------- | ------------------------------ |
| File & workspace management | v3.0.0, v3.1.0, v3.4.0         |
| Bug fixes & stability       | v3.0.1, v3.5.0, v3.6.0, v3.8.1 |
| Writing & export features   | v3.2.0, v3.5.0, v3.5.1         |
| UI & preview improvements   | v3.3.1, v3.7.0, v3.8.0         |
| Web platform support        | v3.6.0, v3.8.0                 |
| Localisation                | v3.6.0                         |
| Session & persistence       | v3.6.0, v3.8.0                 |
