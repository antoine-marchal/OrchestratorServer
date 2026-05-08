const ansiColors: Record<number, string> = {
  30: '#000000', 31: '#cc0000', 32: '#00cc00', 33: '#cccc00',
  34: '#0000cc', 35: '#cc00cc', 36: '#00cccc', 37: '#cccccc',
  90: '#666666', 91: '#ff0000', 92: '#00ff00', 93: '#ffff00',
  94: '#0000ff', 95: '#ff00ff', 96: '#00ffff', 97: '#ffffff',
};

const ansiBgColors: Record<number, string> = {
  40: '#000000', 41: '#cc0000', 42: '#00cc00', 43: '#cccc00',
  44: '#0000cc', 45: '#cc00cc', 46: '#00cccc', 47: '#cccccc',
  100: '#666666', 101: '#ff0000', 102: '#00ff00', 103: '#ffff00',
  104: '#0000ff', 105: '#ff00ff', 106: '#00ffff', 107: '#ffffff',
};

function escapeHtml(text: string): string {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function ansiToHtml(text: string): string {
  if (text == null) return '';
  const escaped = escapeHtml(text);

  let result = '';
  let currentStyles: string[] = [];
  const ansiRegex = /\x1b\[([0-9;]*)m/g;
  let lastIndex = 0;
  let match;

  while ((match = ansiRegex.exec(escaped)) !== null) {
    if (match.index > lastIndex) {
      const textBefore = escaped.slice(lastIndex, match.index);
      result += currentStyles.length > 0
        ? `<span style="${currentStyles.join(';')}">${textBefore}</span>`
        : textBefore;
    }

    const codes = match[1].split(';').map(c => parseInt(c, 10) || 0);
    for (const code of codes) {
      if (code === 0) {
        currentStyles = [];
      } else if (code === 1) {
        currentStyles.push('font-weight:bold');
      } else if (code === 2) {
        currentStyles.push('opacity:0.7');
      } else if (code === 3) {
        currentStyles.push('font-style:italic');
      } else if (code === 4) {
        currentStyles.push('text-decoration:underline');
      } else if (ansiColors[code]) {
        currentStyles = currentStyles.filter(s => !s.startsWith('color:'));
        currentStyles.push(`color:${ansiColors[code]}`);
      } else if (ansiBgColors[code]) {
        currentStyles = currentStyles.filter(s => !s.startsWith('background:'));
        currentStyles.push(`background:${ansiBgColors[code]}`);
      }
    }

    lastIndex = ansiRegex.lastIndex;
  }

  if (lastIndex < escaped.length) {
    const remaining = escaped.slice(lastIndex);
    result += currentStyles.length > 0
      ? `<span style="${currentStyles.join(';')}">${remaining}</span>`
      : remaining;
  }

  return result;
}
