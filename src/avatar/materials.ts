import type { Material, Object3D, Mesh } from 'three';

/**
 * 材质分类：决定调色时属于哪一组（皮肤 / 头发 / 衣服 / 眼睛 / 五官线条 / 其他），
 * 以及黑眼圈贴片投射到哪些网格上。
 *
 * VRoid 导出的材质名带后缀（_SKIN / _HAIR / _CLOTH / _EYE / _FACE），优先按后缀判断；
 * 其他模型按关键词判断；仍无法判断的归入 other（使用整体饱和度）。
 * 个别材质可在模型配置文件 materialCategories 中手动指定。
 */
export type MaterialCategory = 'skin' | 'face' | 'hair' | 'cloth' | 'eye' | 'other';

export const MATERIAL_CATEGORIES: MaterialCategory[] = ['skin', 'face', 'hair', 'cloth', 'eye', 'other'];

export function categorizeMaterialName(name: string, overrides?: Record<string, MaterialCategory>): MaterialCategory {
  if (overrides && overrides[name]) return overrides[name];
  const n = name || '';
  const suffix = n.match(/_(SKIN|HAIR|CLOTH|EYE|FACE)$/);
  if (suffix) {
    return ({ SKIN: 'skin', HAIR: 'hair', CLOTH: 'cloth', EYE: 'eye', FACE: 'face' } as const)[
      suffix[1] as 'SKIN' | 'HAIR' | 'CLOTH' | 'EYE' | 'FACE'
    ];
  }
  if (/eye(?!lash|line|brow)|iris|pupil|highlight|sclera|瞳|目/i.test(n)) return 'eye';
  if (/brow|lash|eyeline|mouth|teeth|tooth|tongue|lip|眉|睫/i.test(n)) return 'face';
  if (/hair|bang|fringe|ponytail|髪|发/i.test(n)) return 'hair';
  if (/cloth|top|bottom|shirt|jacket|coat|dress|skirt|pant|shoe|sock|hood|uniform|outfit|衣|服|鞋/i.test(n)) return 'cloth';
  if (/skin|body|face|head|neck|arm|hand|leg|肌|肤|顔|脸/i.test(n)) return 'skin';
  return 'other';
}

export function materialsOf(mesh: Mesh): Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

export function forEachMesh(root: Object3D, fn: (mesh: Mesh) => void): void {
  root.traverse((o) => {
    if ((o as Mesh).isMesh) fn(o as Mesh);
  });
}

/** MToon 的描边材质会复制一份并标记 isOutline，名字与原材质相同。 */
export function baseMaterialName(m: Material): string {
  return (m.name || '').replace(/\s*\(Outline\)$/i, '');
}
