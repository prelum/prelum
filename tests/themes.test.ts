import { describe, expect, it } from 'vitest';
import { listThemes, loadTheme } from '../src/themes.ts';

describe('themes', () => {
  it('lists the bundled themes', async () => {
    expect(await listThemes()).toEqual(['report', 'technical']);
  });

  it('loads a theme stylesheet', async () => {
    expect(await loadTheme('technical')).toContain('--accent: #2b5fa8');
  });

  it('suggests the closest theme on a typo', async () => {
    await expect(loadTheme('reportt')).rejects.toMatchObject({
      theme: 'reportt',
      available: ['report', 'technical'],
      suggestion: 'report',
    });
  });

  it('ignores case when suggesting', async () => {
    await expect(loadTheme('Technical')).rejects.toMatchObject({ suggestion: 'technical' });
  });

  it('suggests nothing when no theme is close', async () => {
    await expect(loadTheme('academic')).rejects.toMatchObject({ suggestion: undefined });
  });
});
