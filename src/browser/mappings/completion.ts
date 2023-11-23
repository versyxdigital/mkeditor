export const completion = {
  alertblocks: {
    literal: ':::',
    regex: /^:::/,
    types: [
      'success',
      'info',
      'warning',
      'danger',
      'primary',
      'secondary',
      'light',
      'dark'
    ]
  },
  codeblocks: {
    literal: '```',
    regex: /^```/,
    types: [
      'json',
      'javascript',
      'typescript',
      'csharp',
      'php',
      'sql',
      'shell',
      'xml'
    ]
  }
};