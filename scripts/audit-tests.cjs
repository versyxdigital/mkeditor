const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const declarations = new Set(['test', 'it', 'describe']);
const disabledDeclarations = new Set([
  'xit',
  'xtest',
  'xdescribe',
  'fit',
  'ftest',
  'fdescribe',
]);
const forbiddenModifiers = new Set(['skip', 'only', 'todo', 'failing']);

function chainRoot(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isCallExpression(node)) return chainRoot(node.expression);
  if (ts.isTaggedTemplateExpression(node)) return chainRoot(node.tag);
  if (ts.isParenthesizedExpression(node)) return chainRoot(node.expression);
  if (
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node)
  ) {
    return chainRoot(node.expression);
  }
  return null;
}

function propertyName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (
    ts.isElementAccessExpression(node) &&
    node.argumentExpression &&
    ts.isStringLiteralLike(node.argumentExpression)
  ) {
    return node.argumentExpression.text;
  }
  return null;
}

function auditTestSource(file, text) {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const roots = new Set(declarations);
  const disabledRoots = new Set(disabledDeclarations);
  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === '@jest/globals' &&
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      for (const binding of statement.importClause.namedBindings.elements) {
        const imported = (binding.propertyName ?? binding.name).text;
        if (declarations.has(imported)) roots.add(binding.name.text);
        if (disabledDeclarations.has(imported)) {
          disabledRoots.add(binding.name.text);
        }
      }
    }
  }

  const diagnostics = [];
  function report(node, message) {
    const position = source.getLineAndCharacterOfPosition(node.getStart());
    diagnostics.push({
      file,
      line: position.line + 1,
      column: position.character + 1,
      message,
    });
  }

  function hasPromiseMatcher(node) {
    if (
      chainRoot(node) === 'expect' &&
      ['resolves', 'rejects'].includes(propertyName(node))
    ) {
      return true;
    }
    return ts.forEachChild(node, hasPromiseMatcher) ?? false;
  }

  function visit(node) {
    if (
      (ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node)) &&
      roots.has(chainRoot(node)) &&
      forbiddenModifiers.has(propertyName(node))
    ) {
      report(
        node,
        'Tests must run normally; skip, only, todo and failing are forbidden.',
      );
    }
    if (
      ts.isCallExpression(node) &&
      disabledRoots.has(chainRoot(node.expression))
    ) {
      report(node, 'Disabled or focused test declarations are forbidden.');
    }
    if (
      ts.isExpressionStatement(node) &&
      !ts.isAwaitExpression(node.expression) &&
      chainRoot(node.expression) === 'expect' &&
      hasPromiseMatcher(node.expression)
    ) {
      report(node, 'Await or return asynchronous resolves/rejects assertions.');
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return diagnostics;
}

function testFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return testFiles(file);
    return /\.test\.tsx?$/.test(entry.name) ? [file] : [];
  });
}

if (require.main === module) {
  const files = testFiles(path.join(__dirname, '..', 'tests'));
  const diagnostics = files.flatMap((file) =>
    auditTestSource(file, fs.readFileSync(file, 'utf8')),
  );
  for (const issue of diagnostics) {
    console.error(
      `${path.relative(process.cwd(), issue.file)}:${issue.line}:${issue.column} ${issue.message}`,
    );
  }
  if (diagnostics.length) process.exitCode = 1;
  else console.log(`Test policy passed (${files.length} test files).`);
}

module.exports = { auditTestSource };
