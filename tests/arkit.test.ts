import { describe, expect, it } from 'vitest';
import { ARKIT_NAMES, mirrorArkitName, normalizeExpressionName } from '../src/tracking/arkit';
import { categorizeMaterialName } from '../src/avatar/materials';

describe('ARKit 通道', () => {
  it('52 个、互不重复', () => {
    expect(ARKIT_NAMES.length).toBe(52);
    expect(new Set(ARKIT_NAMES).size).toBe(52);
  });
  it('镜像互换左右，且每个 Left 都有对应的 Right', () => {
    expect(mirrorArkitName('eyeBlinkLeft')).toBe('eyeBlinkRight');
    expect(mirrorArkitName('jawRight')).toBe('jawLeft');
    expect(mirrorArkitName('jawOpen')).toBe('jawOpen');
    for (const n of ARKIT_NAMES) expect(ARKIT_NAMES).toContain(mirrorArkitName(n));
  });
  it('名称归一化能匹配常见写法', () => {
    const k = normalizeExpressionName('browDownLeft');
    for (const alt of ['BrowDownLeft', 'blendShape1.browDownLeft', 'ARKit_browDownLeft', 'brow_down_left']) {
      expect(normalizeExpressionName(alt)).toBe(k);
    }
  });
});

describe('材质分组', () => {
  it('VRoid 后缀', () => {
    expect(categorizeMaterialName('N00_000_00_Face_00_SKIN')).toBe('skin');
    expect(categorizeMaterialName('N00_000_Hair_00_HAIR')).toBe('hair');
    expect(categorizeMaterialName('N00_004_01_Tops_01_CLOTH')).toBe('cloth');
    expect(categorizeMaterialName('N00_000_00_EyeWhite_00_EYE')).toBe('eye');
    expect(categorizeMaterialName('N00_000_00_FaceEyelash_00_FACE')).toBe('face');
  });
  it('通用关键词与手动指定', () => {
    expect(categorizeMaterialName('Body')).toBe('skin');
    expect(categorizeMaterialName('Eyelash')).toBe('face');
    expect(categorizeMaterialName('EyeIris_L')).toBe('eye');
    expect(categorizeMaterialName('Jacket')).toBe('cloth');
    expect(categorizeMaterialName('Material.001')).toBe('other');
    expect(categorizeMaterialName('Material.001', { 'Material.001': 'skin' })).toBe('skin');
  });
});
