const taskLists = (md, options) => {
    let defaults
    defaults = {
        disabled: true,
        ulClass: 'task-list',
        liClass: 'task-list-item'
    }
    options = Object.assign({}, defaults, options)
    md.core.ruler.after('inline', 'github-task-lists', (state) => {
        let tokens = state.tokens
        
        for (let i = 2; i < tokens.length; ++i) {
            if (isTaskListItem(tokens, i)) {
                convert(tokens[i], options, tokens, tokens[i-2], state.Token)
                attrSet(tokens[i-2], 'class', options.liClass)
                attrSet(tokens[parentTokenIndex(tokens, i-2)], 'class', options.ulClass)
            }
        }

        let group = 1
        tokens.forEach((token) => {
            if (token.attrs && token.attrs[0][1] === 'task-list') {
                attrSet(token, 'data-group', group)
                group++
            }
        })
    })
}

function attrSet(token, name, value) {
    let index = token.attrIndex(name)
    let attr = [name, value]

    if (index < 0) {
        token.attrPush(attr)
    } else {
        token.attrs[index] = attr
    }
}

function parentTokenIndex(tokens, index) {
    let targetLevel = tokens[index].level - 1
    for (let i = index - 1; i >= 0; --i) {
        if (tokens[i].level === targetLevel) {
            return i
        }
    }
    return -1
}

function isTaskListItem(tokens, index) {
    return isInline(tokens[index]) &&
        isParagraph(tokens[index - 1]) &&
        isListItem(tokens[index - 2]) &&
        startsWithTodoMarkdown(tokens[index])
}

function convert(token, options, tokens, targetToken, TokenConstructor) {
    token.children[0].content = token.children[0].content.slice(3)

    // checkbox
    targetToken.children = targetToken.children || []
    const checkbox = makeCheckbox(token, options, TokenConstructor)
    targetToken.children.unshift(checkbox)
}

function makeCheckbox(token, options, TokenConstructor) {
    let checkbox = new TokenConstructor('checkbox_input', 'input', 0)
    checkbox.attrs = [['type', 'checkbox']]
    let checked = /^\[[xX]\][ \u00A0]/.test(token.content) // if token.content starts with '[x] ' or '[X] '
    if (checked === true) {
        checkbox.attrs.push(['checked', 'true'])
    }
    if (options.disabled === true) {
        checkbox.attrs.push(['disabled', 'true'])
    }

    return checkbox
}

function startsWithTodoMarkdown(token) {
    return /^\[[xX \u00A0]\][ \u00A0]/.test(token.content)
}

function isInline(token) { return token.type === 'inline' }
function isParagraph(token) { return token.type === 'paragraph_open' }
function isListItem(token) { return token.type === 'list_item_open' }

export default taskLists