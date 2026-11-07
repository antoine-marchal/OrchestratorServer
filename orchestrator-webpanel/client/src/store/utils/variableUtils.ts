import type { Node } from '../../types/xyflow';


/**
 * Sanitize a variable name to be a valid JavaScript identifier
 */
export function sanitizeVariableName(name: string): string {
  // Replace invalid characters with underscores
  let sanitized = name.replace(/[^a-zA-Z0-9_$]/g, '_');
  // Ensure it doesn't start with a number
  if (/^[0-9]/.test(sanitized)) {
    sanitized = '_' + sanitized;
  }
  // Avoid reserved words
  const reserved = ['input', 'output', 'console', 'process', 'require', 'module', 'exports'];
  if (reserved.includes(sanitized)) {
    sanitized = 'var_' + sanitized;
  }
  return sanitized || '_var';
}

/**
 * Collects all Variable nodes and returns them as a key-value object
 * Keys are sanitized node labels, values are parsed JSON or raw strings
 * Prioritizes runtime output value over initial value (for variable persistence during flow execution)
 */
export function collectVariables(nodes: Node[]): Record<string, any> {
  const variables: Record<string, any> = {};

  nodes.forEach(node => {
    if (node.data?.type === 'variable' && node.data.label) {
      const varName = sanitizeVariableName(node.data.label);

      // Prioritize runtime output if it exists (modified by previous nodes)
      if (node.data.output !== undefined) {
        variables[varName] = node.data.output;
      } else {
        // Fallback to initial value, parse as JSON if possible
        const rawValue = node.data.value || '';
        try {
          variables[varName] = JSON.parse(rawValue);
        } catch {
          variables[varName] = rawValue;
        }
      }
    }
  });

  return variables;
}

/**
 * Updates Variable nodes with modified values from execution
 */
export function updateVariableNodes(
  nodes: Node[],
  modifiedVariables: Record<string, any>
): Node[] {
  return nodes.map(node => {
    if (node.data?.type === 'variable' && node.data.label) {
      const varName = sanitizeVariableName(node.data.label);
      if (varName in modifiedVariables) {
        const newValue = modifiedVariables[varName];
        return {
          ...node,
          data: {
            ...node.data,
            output: newValue, // Show current runtime value
          }
        };
      }
    }
    return node;
  });
}
