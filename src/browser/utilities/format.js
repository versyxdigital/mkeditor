export function formatHTML (html) {
    const tab = '\t';
    let result = '';
    let indent = '';

    for (const element of html.split(/>\s*</)) {
        if (element.match(/^\/\w/)) {
            indent = indent.substring(tab.length);
        }

        result += indent + '<' + element + '>\r\n';

        if (element.match(/^<?\w[^>]*[^/]$/) && !element.startsWith('input')) {
            indent += tab;
        }
    }

    return result.substring(1, result.length - 3);
}
