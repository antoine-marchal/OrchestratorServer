/**
 * Format utility functions for data display
 */

/**
 * Pretty-format a value for display in console/output
 * Handles objects, JSON strings, and primitive values
 */
export function prettyFormat(val: any): string {
  if (val == null) return '';
  if (typeof val === 'object') {
    try {
      return JSON.stringify(val, null, 2);
    } catch {
      return String(val);
    }
  }
  if (typeof val === 'string') {
    // Try to pretty-print if string looks like JSON
    try {
      const parsed = JSON.parse(val);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return val;
    }
  }
  return String(val);
}
