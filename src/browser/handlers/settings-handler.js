import { editor } from 'monaco-editor/esm/vs/editor/editor.api';

/**
 * Settings Handler
 *
 * Designed to work with both localStorage for web browser-based editors
 * and IPC for electron app editors.
 */
class SettingsHandler {
    /**
     * @var {object}
     */
    settings = {
        toggleAutoIndent: false,
        toggleDarkMode: false,
        toggleWordWrap: true,
        toggleWhitespace: false,
        toggleMinimap: true
    };

    /**
     * Create a new Settings Handler.
     *
     * The settings handler manages settings for both web and electron runtime environments.
     * Web uses localStorage, electron uses a file stored at %HOME%/.mkeditor/settings.json.
     *
     * @param {object} editor the editor created through mkeditor.create({...})
     * @param {boolean} persistSettings choose to persist settings through localStorage
     * @param {object|null} storedSettings  Load stored settings from a settings file
     */
    constructor (editor, { persistSettings = false, storedSettings = null }, register = false) {
        this.editor = editor;
        this.persistSettings = persistSettings;

        if (localStorage.getItem('settings')) {
            this.settings = JSON.parse(localStorage.getItem('settings'));
        } else if (storedSettings) {
            console.log('Using settings from stored file');
            this.settings = storedSettings;
        }

        if (register) {
            this.register();
        }
    }

    /**
     * Register all event handlers
     */
    register () {
        this.addAutoIndentToggleHandler()
            .addDarkModeToggleHandler()
            .addWordWrapToggleHandler()
            .addWhitespaceToggleHandler()
            .addMinimapToggleHandler();

        if (this.persistSettings) {
            this.addPersistSettingsHandlerForWeb()
                .setState();
        }
    }

    /**
     * Get the currently applied settings
     *
     * @returns {*} settings
     */
    getSettings () {
        return this.settings;
    }

    /**
     * Set settings to be applied
     *
     * @param {*} settings
     */
    setSettings (settings) {
        this.settings = settings;
    }

    /**
     * Set the state for the active settings
     *
     * @returns {void}
     */
    setState () {
        const targets = document.querySelectorAll('#settings .setting');
        if (targets) {
            for (const target of targets) {
                target.checked = this.settings[target.id];
            }
        }
    }

    /**
     * Add the localStorage persistent settings handler for web.
     *
     * @returns {this}
     */
    addPersistSettingsHandlerForWeb () {
        const persistSettings = document.querySelector('#save-app-settings');
        if (persistSettings) {
            persistSettings.addEventListener('click', () => {
                localStorage.setItem('settings', JSON.stringify(this.settings));
            });
        }

        return this;
    }

    /**
     * Auto-indent toggle handler.
     *
     * Configures automatic-indentation for things like carriage returns.
     * The value is automatically saved to localStorage for web whenever it is updated.
     * For Electron, the settings are stored to file when the user clicks "save settings".
     *
     * @returns
     */
    addAutoIndentToggleHandler () {
        const toggleAutoIndent = document.querySelector('#toggleAutoIndent');
        if (toggleAutoIndent) {
            toggleAutoIndent.addEventListener('click', (event) => {
                let option;

                if (event.target.checked) {
                    option = 'advanced';
                    this.settings.toggleAutoIndent = true;
                } else {
                    option = 'none';
                    this.settings.toggleAutoIndent = false;
                }

                this.editor.updateOptions({ autoIndent: option });
            });
        }

        return this;
    }

    /**
     * Dark mode toggle handler.
     *
     * Configures dark mode for the editor.
     * The value is automatically saved to localStorage for web whenever it is updated.
     * For Electron, the settings are stored to file when the user clicks "save settings".
     *
     * @returns
     */
    addDarkModeToggleHandler () {
        const toggleDarkMode = document.querySelector('#toggleDarkMode');
        const toggleDarkModeIcon = document.querySelector('#darkModeIcon');
        if (toggleDarkMode) {
            toggleDarkMode.addEventListener('click', (event) => {
                let theme;
                if (event.target.checked) {
                    theme = 'vs-dark';
                    document.body.setAttribute('data-theme', 'dark');
                    toggleDarkModeIcon.classList.remove('text-dark');
                    toggleDarkModeIcon.classList.add('text-warning');
                    this.settings.toggleDarkMode = true;
                } else {
                    theme = 'gdmTheme';
                    document.body.setAttribute('data-theme', 'light');
                    toggleDarkModeIcon.classList.remove('text-warning');
                    toggleDarkModeIcon.classList.add('text-dark');
                    this.settings.toggleDarkMode = false;
                }

                editor.setTheme(theme);
            });
        }

        return this;
    }

    /**
     * Word wrap toggle handler.
     *
     * Configures word-wrapping for the editor.
     * The value is automatically saved to localStorage for web whenever it is updated.
     * For Electron, the settings are stored to file when the user clicks "save settings".
     *
     * @returns
     */
    addWordWrapToggleHandler () {
        const toggleWordWrap = document.querySelector('#toggleWordWrap');
        if (toggleWordWrap) {
            toggleWordWrap.addEventListener('click', (event) => {
                let option;
                if (event.target.checked) {
                    option = 'on';
                    this.settings.toggleWordWrap = true;
                } else {
                    option = 'off';
                    this.settings.toggleWordWrap = false;
                }

                this.editor.updateOptions({ wordWrap: option });
            });
        }

        return this;
    }

    /**
     * Whitespace toggle handler.
     *
     * Configures whitespace rendering for the editor.
     * The value is automatically saved to localStorage for web whenever it is updated.
     * For Electron, the settings are stored to file when the user clicks "save settings".
     *
     * @returns
     */
    addWhitespaceToggleHandler () {
        const toggleWhitespace = document.querySelector('#toggleWhitespace');
        if (toggleWhitespace) {
            toggleWhitespace.addEventListener('click', (event) => {
                let option;
                if (event.target.checked) {
                    option = 'all';
                    this.settings.toggleWhitespace = true;
                } else {
                    option = 'none';
                    this.settings.toggleWhitespace = false;
                }

                this.editor.updateOptions({ renderWhitespace: option });
            });
        }

        return this;
    }

    /**
     * Minimap toggle handler.
     *
     * Configures display of the minimap for the editor.
     * The value is automatically saved to localStorage for web whenever it is updated.
     * For Electron, the settings are stored to file when the user clicks "save settings".
     *
     * @returns
     */
    addMinimapToggleHandler () {
        const toggleMinimap = document.querySelector('#toggleMinimap');
        if (toggleMinimap) {
            toggleMinimap.addEventListener('click', (event) => {
                let option;
                if (event.target.checked) {
                    option = { enabled: true };
                    this.settings.toggleMinimap = true;
                } else {
                    option = { enabled: false };
                    this.settings.toggleMinimap = false;
                }

                this.editor.updateOptions({ minimap: option });
            });
        }

        return this;
    }
}

export default SettingsHandler;
