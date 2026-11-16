import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

describe('默认模型 public/models/avatar.vrm', () => {
  it.skipIf(!fs.existsSync('public/models/avatar.vrm'))('包含 52 个 ARKit 表情和本项目用到的全部骨骼', () => {
    const out = execFileSync('node', ['scripts/inspect-model.mjs', 'public/models/avatar.vrm'], { encoding: 'utf8' });
    expect(out).toContain('52 / 52');
    expect(out).not.toContain('缺失：');
    expect(out).toMatch(/VRM 0\.x|VRM 1\.0/);
  });
});
