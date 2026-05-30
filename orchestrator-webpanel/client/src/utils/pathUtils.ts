// src/utils/pathUtils.ts
export const pathUtils = {

  isAbsolute: (p: string): boolean => {
    return p.startsWith('/') || /^[A-Za-z]:[\\\/]/.test(p);
  },

join: (...segments: string[]): string => {
  const parts: string[] = [];

  for (let segment of segments) {
    // Normalize slashes
    segment = segment.replace(/\\/g, '/');

    for (const part of segment.split('/')) {
      if (part === '' || part === '.') continue;
      if (part === '..') {
        if (parts.length && parts[parts.length - 1] !== '..') {
          parts.pop();
        } else {
          parts.push('..');
        }
      } else {
        parts.push(part);
      }
    }
  }

  let result = parts.join('/');

  // Preserve root on absolute Windows paths like C:/
  if (/^[A-Za-z]:$/.test(segments[0])) {
    result = segments[0] + '/' + result;
  } else if (segments[0].startsWith('/')) {
    result = '/' + result;
  }

  return result;
},

  dirname: (p: string): string => {
    // Normalize path separators to forward slashes for consistent handling
    p = p.replace(/\\/g, '/');
    
    // Remove trailing slashes
    p = p.replace(/\/$/, '');
    
    // Find the last slash
    const lastSlashIndex = p.lastIndexOf('/');
    
    // Handle cases where no slash is found
    if (lastSlashIndex === -1) return '.';
    
    // Handle root directories
    if (lastSlashIndex === 0) return '/';
    
    // Handle Windows drive roots (e.g., C:/)
    if (lastSlashIndex === 2 && /^[A-Za-z]:\//.test(p.substring(0, 3))) {
      return p.substring(0, 3);
    }
    
    // Return the directory part
    return p.substring(0, lastSlashIndex);
  },
  
  resolve: (dir: string, relativePath: string): string => {
    // Handle absolute paths in relativePath
    if (pathUtils.isAbsolute(relativePath)) return relativePath;
    
    // Normalize slashes to the system preference (using / for simplicity)
    dir = dir.replace(/\\/g, '/');
    relativePath = relativePath.replace(/\\/g, '/');
    
    // Ensure dir ends with a slash
    if (!dir.endsWith('/')) dir += '/';
    
    // Combine and normalize the path
    let result = dir + relativePath;
    
    // Handle ../ and ./ in the path
    const parts = result.split('/');
    const normalized = [];
    
    for (const part of parts) {
      if (part === '.' || part === '') continue;
      if (part === '..' && normalized.length > 0 && normalized[normalized.length - 1] !== '..') {
        normalized.pop();
      } else {
        normalized.push(part);
      }
    }
    
    result = normalized.join('/');
    
    // Ensure drive letter is preserved on Windows
    if (/^[A-Za-z]:/.test(dir)) {
      const drive = dir.substring(0, 2);
      if (!result.startsWith(drive)) {
        result = drive + '/' + result;
      }
    }
    
    return result;
  },
  
  relative: (from: string, to: string): string => {
    // Normalize slashes
    from = from.replace(/\\/g, '/');
    to = to.replace(/\\/g, '/');
    
    // Ensure paths don't end with a slash
    from = from.replace(/\/$/, '');
    to = to.replace(/\/$/, '');
    
    // Split paths into segments
    const fromParts = from.split('/');
    const toParts = to.split('/');
    
    // Find common prefix
    let i = 0;
    while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) {
      i++;
    }
    
    // Build relative path
    const upCount = fromParts.length - i;
    const relativeParts = Array(upCount).fill('..').concat(toParts.slice(i));
    
    return relativeParts.join('/') || '.';
  }
};
