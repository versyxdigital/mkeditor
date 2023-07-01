const codeBlocks = (instance, options) => {
    const defaults = {
        templateSelector: '#copyCode',
        contentSelector: 'body',
        loadDelay: 0,
        copyIconClass: 'fa fa-clipboard',
        copyIconContent: '',
        checkIconClass: 'fa fa-check text-success',
        checkIconContent: '',
        onBeforeCodeCopied: null
    }

    options = Object.assign({}, defaults, options)

    function init(config) {
        Object.assign(options, config)
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', load)
        } else {
            load()
        }
    }

    function load() {
        if (options.loadDelay) {
            setTimeout(addButton, options.loadDelay)
        } else {
            addButton()
        }
    }

    function addButton() {
        if (!document.querySelector(options.templateSelector)) {
            const node = document.createElement('div')
            node.innerHTML = getTemplate()
            document.body.appendChild(node.querySelector(options.templateSelector))
        }

        const blocks = document.querySelectorAll('pre>code.hljs')
        for (let index = 0; index < blocks.length; index++) {
            let el = blocks[index]
            if (el.querySelector('.copy-code')) {
                continue
            }

            let lang = ''
            for (let i = 0; i < el.classList.length; i++) {
                let cl = el.classList[i]
                if (cl.substring(0, 9) === 'language-') {
                    lang = el.classList[i].replace('language-', '')
                    break
                } else if (cl.substring(0, 5) === 'lang-') {
                    lang = el.classList[i].replace('lang-', '')
                    break
                }

                if (!lang) {
                    for (let j = 0; j < el.classList.length; j++) {
                        if (el.classList[j] === 'hljs') {
                            continue
                        }
                        lang = el.classList[j]
                        break
                    }
                }
            }

            if (lang) {
                lang = lang.toLowerCase()
            } else {
                lang = 'text'
            }

            const html = document.querySelector(options.templateSelector).innerHTML
                .replace('{{language}}', lang)
                .replace('{{copyIconClass}}', options.copyIconClass)
                .trim()

            let newButton = document.createElement('div')
            newButton.innerHTML = html
            newButton = newButton.querySelector('.copy-code')

            const pre = el.parentElement
            pre.classList.add('copy-code-pre')

            if (options.copyIconContent) {
                newButton.querySelector('.copy-code-copy-icon').innerText = options.copyIconContent
            }

            pre.insertBefore(newButton, el)
        }

        document.querySelector(options.contentSelector).addEventListener('click', (event) => {
            if (event.target.classList.contains('copy-code-copy-icon')) {
                event.preventDefault()
                event.cancelBubble = true
                copyCodeToClipboard(event)
            }

            return false
        })
    }

    function copyCodeToClipboard(event) {
        const source = event.target.parentElement.parentElement.parentElement
        const code = source.querySelector('pre>code')
        let text = code.textContent || code.innerText

        if (options.onBeforeCodeCopied) {
            text = options.onBeforeCodeCopied(text, code)
        }

        const el = document.createElement('textarea')
        el.value = text.trim()

        document.body.appendChild(el)

        el.style.display = 'block'
        el.select()

        document.execCommand('copy')
        document.body.removeChild(el)

        swapIcons(source)
    }

    function swapIcons(source) {
        const copyIcons = options.copyIconClass.split(' ')
        const checkIcons = options.checkIconClass.split(' ')
        const fa = source.querySelector('.copy-code-copy-icon')
        fa.innerText = options.checkIconContent

        for (let i = 0; i < copyIcons.length; i++) {
            fa.classList.remove(copyIcons[i])
        }

        for (let i = 0; i < checkIcons.length; i++) {
            fa.classList.add(checkIcons[i])
        }

        setTimeout(function () {
            fa.innerText = options.copyIconContent

            for (let i = 0; i < checkIcons.length; i++) {
                fa.classList.remove(checkIcons[i])
            }

            for (let i = 0; i < copyIcons.length; i++) {
                fa.classList.add(copyIcons[i])
            }
        }, 2000)
    }

    function getTemplate() {
        const parts =
            [
                '<div id="copyCode" style="display:none">',
                '    <div class="copy-code">',
                '        <div class="copy-code-language">{{language}}</div>',
                '        <div  title="Copy to clipboard">',
                '            <i class="{{copyIconClass}} copy-code-copy-icon"></i></i></a>',
                '        </div>',
                '     </div>',
                '</div>'
            ]

        let html = ''
        for (let i = 0; i < parts.length; i++) {
            html += parts[i] + '\n'
        }

        return html
    }

    init(options)
}

export default codeBlocks