import { describe, it, expect } from 'vitest';
import { extractSecretNames, substituteSecrets, SECRET_REF_RE } from '../src/routes/secrets';

describe('secret placeholder utilities', () => {
  it('extracts a single secret reference', () => {
    expect(extractSecretNames('const x = "${{ secrets.API_KEY }}"')).toEqual(['API_KEY']);
  });

  it('extracts multiple distinct references, deduped', () => {
    const code = '${{ secrets.A }} + ${{secrets.B}} + ${{ secrets.A }}';
    expect(extractSecretNames(code).sort()).toEqual(['A', 'B']);
  });

  it('returns empty on no placeholders', () => {
    expect(extractSecretNames('plain code with no refs')).toEqual([]);
    expect(extractSecretNames('')).toEqual([]);
  });

  it('substitutes resolved values inline', () => {
    const out = substituteSecrets('Authorization: Bearer ${{ secrets.TOKEN }}', { TOKEN: 'xyz' });
    expect(out).toBe('Authorization: Bearer xyz');
  });

  it('replaces missing names with the literal `undefined` (keeps JS parseable)', () => {
    const out = substituteSecrets('let k = ${{ secrets.MISSING }};', {});
    expect(out).toBe('let k = undefined;');
  });

  it('regex tolerates surrounding whitespace', () => {
    const matches = [...'${{   secrets.WITH_SPACES   }}'.matchAll(SECRET_REF_RE)];
    expect(matches[0][1]).toBe('WITH_SPACES');
  });
});
