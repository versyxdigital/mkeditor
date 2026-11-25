/** Caller verifies containment before remapping a path or one of its descendants. */
export function remapLocalPath(
  path: string,
  source: string,
  destination: string,
): string {
  const suffix = path
    .slice(source.replace(/[/\\]+$/, '').length)
    .replace(/^[/\\]+/, '');
  const separator = destination.includes('\\') ? '\\' : '/';
  return suffix
    ? destination.replace(/[/\\]+$/, '') +
        separator +
        suffix.replace(/[/\\]/g, separator)
    : destination;
}
