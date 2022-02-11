import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'

class SettingsHandler {
    constructor(instance, persistence = false) {
        this.editor = instance
        this.persist = persistence

        if (localStorage.getItem('settings')) {
            this.settings = JSON.parse(localStorage.getItem('settings'))
        } else {
            this.settings = {
                toggleAutoIndent: false,
                toggleDarkMode: false,
                toggleWordWrap: true
            }
        }
    }
    
    register() {
        this.addAutoIndentToggleHandler()
            .addDarkModeToggleHandler()
            .addWordWrapToggleHandler()
            .addWhitespaceToggleHandler()
        
        if (this.persist) {
            this.addPersistSettingsHandler()
                .applySettingsOnLoad()
        }
    }
    
    applySettingsOnLoad() {
        let targets = document.querySelectorAll('#settings .setting')
        if (targets) {
            targets.forEach((target) => {
                target.checked = this.settings[target.id]
            })
        }
    }
    
    addPersistSettingsHandler() {
        let persistSettings = document.querySelector('#persistSettings')
        if (persistSettings) {
            persistSettings.addEventListener('click', () => {
                localStorage.setItem('settings', JSON.stringify(this.settings))
            })
        }
        
        return this
    }

    addAutoIndentToggleHandler() {
        let toggleAutoIndent = document.querySelector('#toggleAutoIndent')
        if (toggleAutoIndent) {
            toggleAutoIndent.addEventListener('click', (event) => {
                let option
                
                if (event.target.checked) {
                    option = 'advanced'
                    this.settings.toggleAutoIndent = true
                } else {
                    option = 'none'
                    this.settings.toggleAutoIndent = false
                }
                
                this.editor.updateOptions({ autoIndent: option })
            })
        }
        
        return this
    }

    addDarkModeToggleHandler() {
        let toggleDarkMode = document.querySelector('#toggleDarkMode')
        let toggleDarkModeIcon = document.querySelector('#darkModeIcon')
        if (toggleDarkMode) {
            document.body.setAttribute('data-theme', 'light')
            toggleDarkMode.addEventListener('click', (event) => {
                let theme
                if (event.target.checked) {
                    theme = 'vs-dark'
                    document.body.setAttribute('data-theme', 'dark')
                    toggleDarkModeIcon.classList.remove('text-dark')
                    toggleDarkModeIcon.classList.add('text-warning')
                    this.settings.toggleDarkMode = true
                } else {
                    theme = 'gdmTheme'
                    document.body.removeAttribute('data-theme')
                    toggleDarkModeIcon.classList.remove('text-warning')
                    toggleDarkModeIcon.classList.add('text-dark')
                    this.settings.toggleDarkMode = false
                }

                monaco.editor.setTheme(theme)
            })
        }
        
        return this
    }

    addWordWrapToggleHandler() {
        let toggleWordWrap = document.querySelector('#toggleWordWrap')
        if (toggleWordWrap) {
            toggleWordWrap.addEventListener('click', (event) => {
                let option
                if (event.target.checked) {
                    option = 'on'
                    this.settings.toggleWordWrap = true
                } else {
                    option = 'off'
                    this.settings.toggleWordWrap = false
                }

                this.editor.updateOptions({ wordWrap: option })
            })
        }
        
        return this
    }

    addWhitespaceToggleHandler() {
        let toggleWhitespace = document.querySelector('#toggleWhitespace')
        if (toggleWhitespace) {
            toggleWhitespace.addEventListener('click', (event) => {
                let option
                if (event.target.checked) {
                    option = 'all'
                    this.settings.toggleWhitespace = true
                } else {
                    option = 'none'
                    this.settings.toggleWhitespace = false
                }

                this.editor.updateOptions({ renderWhitespace: option })
            })
        }

        return this
    }
}

export default SettingsHandler