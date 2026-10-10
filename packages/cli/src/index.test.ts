import { describe, expect, it } from 'vitest';
import { run } from './index.ts';

function capture(argv: string[]) {
  let stdout = '';
  let stderr = '';
  const code = run(argv, {
    version: '1.2.3',
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
  });
  return { code, stdout, stderr };
}

describe('run', () => {
  it('prints the version', () => {
    expect(capture(['--version'])).toEqual({ code: 0, stdout: '1.2.3\n', stderr: '' });
    expect(capture(['-v']).stdout).toBe('1.2.3\n');
  });

  it('prints usage with no arguments or --help', () => {
    for (const argv of [[], ['--help'], ['-h']]) {
      const result = capture(argv);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Usage: field-notes');
    }
  });

  it('fails with exit code 2 on unknown commands', () => {
    const result = capture(['frobnicate']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Unknown command: frobnicate');
  });

  it('fails with exit code 2 on unknown options', () => {
    const result = capture(['--nope']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Usage: field-notes');
  });
});
