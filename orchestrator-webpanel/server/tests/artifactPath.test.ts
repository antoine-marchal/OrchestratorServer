import { describe, it, expect } from 'vitest';
import path from 'path';
import { safeArtifactPath } from '../src/domain/execution/nodeExecutor';

describe('safeArtifactPath', () => {
  const TARGET = path.resolve('/tmp/orchestrator-test-target');

  it('accepts a simple relative filename', () => {
    expect(safeArtifactPath('data.txt', TARGET)).toBe(path.join(TARGET, 'data.txt'));
  });

  it('accepts a nested relative path', () => {
    expect(safeArtifactPath('sub/dir/file.bin', TARGET)).toBe(path.join(TARGET, 'sub', 'dir', 'file.bin'));
  });

  it('rejects parent-traversal that escapes target', () => {
    expect(safeArtifactPath('../escape.txt', TARGET)).toBeNull();
    expect(safeArtifactPath('../../etc/passwd', TARGET)).toBeNull();
    expect(safeArtifactPath('a/../../escape', TARGET)).toBeNull();
  });

  it('rejects absolute paths', () => {
    expect(safeArtifactPath('/etc/passwd', TARGET)).toBeNull();
    expect(safeArtifactPath('C:/Windows/System32/cmd.exe', TARGET)).toBeNull();
    expect(safeArtifactPath('//server/share/x', TARGET)).toBeNull();
  });

  it('rejects empty / whitespace / non-string', () => {
    expect(safeArtifactPath('', TARGET)).toBeNull();
    expect(safeArtifactPath('   ', TARGET)).toBeNull();
    expect(safeArtifactPath(undefined as any, TARGET)).toBeNull();
    expect(safeArtifactPath(42 as any, TARGET)).toBeNull();
  });

  it('allows `..` segments that resolve back inside target', () => {
    const p = safeArtifactPath('sub/../keep.txt', TARGET);
    expect(p).toBe(path.join(TARGET, 'keep.txt'));
  });

  it('handles Windows-style backslash traversal attempts', () => {
    expect(safeArtifactPath('..\\..\\Windows\\System32', TARGET)).toBeNull();
  });
});
