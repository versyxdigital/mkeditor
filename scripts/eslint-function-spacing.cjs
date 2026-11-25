/** Padding between adjacent function definitions; Prettier collapses excess blank lines. */
function isFunction(node) {
  if (!node) return false;
  if (
    node.type === 'ExportNamedDeclaration' ||
    node.type === 'ExportDefaultDeclaration'
  )
    return isFunction(node.declaration);
  if (node.type === 'VariableDeclaration')
    return node.declarations.some((declaration) =>
      isFunction(declaration.init),
    );
  if (
    ['Property', 'MethodDefinition', 'PropertyDefinition'].includes(node.type)
  )
    return isFunction(node.value);
  if (
    [
      'TSAsExpression',
      'TSSatisfiesExpression',
      'TSNonNullExpression',
      'TSTypeAssertion',
    ].includes(node.type)
  )
    return isFunction(node.expression);
  if (
    [
      'FunctionDeclaration',
      'FunctionExpression',
      'ArrowFunctionExpression',
    ].includes(node.type)
  )
    return Boolean(node.body);
  // React wrappers still declare a named component, rather than a plain value.
  if (node.type === 'CallExpression') {
    const name =
      node.callee.type === 'MemberExpression'
        ? node.callee.property.name
        : node.callee.name;
    return (
      ['memo', 'forwardRef'].includes(name) && isFunction(node.arguments[0])
    );
  }
  return false;
}

module.exports = {
  meta: {
    type: 'layout',
    fixable: 'whitespace',
    schema: [],
    messages: { padding: 'Leave one blank line between function definitions.' },
  },
  create(context) {
    const source = context.sourceCode;
    function check(nodes) {
      for (let index = 1; index < nodes.length; index++) {
        const previous = nodes[index - 1];
        const next = nodes[index];
        if (!isFunction(previous) || !isFunction(next)) continue;
        let anchor = source.getLastToken(previous);
        // Keep commas and trailing comments with the previous definition, and
        // put the blank line before the following function's documentation.
        for (const token of source.getTokensBetween(previous, next, {
          includeComments: true,
        })) {
          if (token.loc.start.line !== anchor.loc.end.line) break;
          anchor = token;
        }
        const following = source.getTokenAfter(anchor, {
          includeComments: true,
        });
        if (following.loc.start.line - anchor.loc.end.line > 1) continue;
        context.report({
          node: next,
          messageId: 'padding',
          fix(fixer) {
            const newline = source.text.includes('\r\n') ? '\r\n' : '\n';
            return fixer.insertTextAfter(
              anchor,
              following.loc.start.line === anchor.loc.end.line
                ? newline + newline
                : newline,
            );
          },
        });
      }
    }

    return {
      Program: (node) => check(node.body),

      BlockStatement: (node) => check(node.body),

      ClassBody: (node) => check(node.body),

      ObjectExpression: (node) => check(node.properties),

      SwitchCase: (node) => check(node.consequent),
    };
  },
};
