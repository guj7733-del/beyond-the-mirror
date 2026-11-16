import type { IUniform, Material, Object3D, WebGLProgramParametersWithUniforms } from 'three';
import type { FatigueParams } from '../fatigue/stages';
import {
  MATERIAL_CATEGORIES,
  baseMaterialName,
  categorizeMaterialName,
  forEachMesh,
  materialsOf,
  type MaterialCategory,
} from './materials';

interface GradeUniforms {
  bmSat: IUniform<number>;
  bmBright: IUniform<number>;
  bmPallor: IUniform<number>;
}

export interface GradedMaterialInfo {
  name: string;
  category: MaterialCategory;
  /** 是否成功注入调色代码（未知 shader 时为 false，降级为不调色）。 */
  patched: boolean;
  type: string;
}

const GRADE_GLSL = /* glsl */ `
uniform float bmSat;
uniform float bmBright;
uniform float bmPallor;
vec3 bmGrade( vec3 c ) {
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  vec3 g = mix( vec3( l ), c, bmSat );
  vec3 pale = vec3( l ) * vec3( 0.9, 0.96, 1.06 );
  g = mix( g, pale, bmPallor );
  return g * bmBright;
}
`;

/**
 * 材质调色器：给角色的每个材质注入一个“饱和度 / 苍白度 / 亮度”调整函数，
 * 按材质分类共享 uniform，因此每帧只改几个数值，不需要重新编译 shader。
 * 支持 three-vrm 的 MToonMaterial 以及 three.js 内置材质（GLB 模型常用）。
 */
export class MaterialGrader {
  readonly info: GradedMaterialInfo[] = [];
  private readonly groups: Record<MaterialCategory, GradeUniforms>;

  constructor(root: Object3D, overrides?: Record<string, MaterialCategory>) {
    this.groups = {} as Record<MaterialCategory, GradeUniforms>;
    for (const c of MATERIAL_CATEGORIES) {
      this.groups[c] = { bmSat: { value: 1 }, bmBright: { value: 1 }, bmPallor: { value: 0 } };
    }
    const seen = new Set<Material>();
    forEachMesh(root, (mesh) => {
      if (mesh.userData.bmOverlay) return;
      for (const m of materialsOf(mesh)) {
        if (!m || seen.has(m)) continue;
        seen.add(m);
        const name = baseMaterialName(m);
        const category = categorizeMaterialName(name, overrides);
        const patched = this.patch(m, this.groups[category]);
        if (!(m as Material & { isOutline?: boolean }).isOutline || !this.info.some((i) => i.name === name)) {
          this.info.push({ name, category, patched, type: m.type });
        }
      }
    });
  }

  private patch(m: Material, u: GradeUniforms): boolean {
    const t = m.type;
    const supported =
      (m as Material & { isMToonMaterial?: boolean }).isMToonMaterial ||
      ['MeshStandardMaterial', 'MeshPhysicalMaterial', 'MeshBasicMaterial', 'MeshLambertMaterial', 'MeshPhongMaterial', 'MeshToonMaterial', 'MeshMatcapMaterial'].includes(t);
    if (!supported) return false;
    const prevCompile = m.onBeforeCompile;
    const prevKey = m.customProgramCacheKey;
    let ok = true;
    m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
      prevCompile.call(m, shader, renderer);
      const fs = shader.fragmentShader;
      let out = fs;
      if (fs.includes('gl_FragColor = vec4( col, diffuseColor.a );')) {
        // three-vrm MToon
        out = fs.replace('gl_FragColor = vec4( col, diffuseColor.a );', 'gl_FragColor = vec4( bmGrade( col ), diffuseColor.a );');
      } else if (fs.includes('#include <opaque_fragment>')) {
        out = fs.replace('#include <opaque_fragment>', '#include <opaque_fragment>\n  gl_FragColor.rgb = bmGrade( gl_FragColor.rgb );');
      } else {
        ok = false;
        return;
      }
      out = out.replace('void main() {', `${GRADE_GLSL}\nvoid main() {`);
      shader.fragmentShader = out;
      shader.uniforms.bmSat = u.bmSat;
      shader.uniforms.bmBright = u.bmBright;
      shader.uniforms.bmPallor = u.bmPallor;
    };
    m.customProgramCacheKey = () => `${prevKey.call(m)}|bmGrade1`;
    m.needsUpdate = true;
    return ok;
  }

  apply(f: FatigueParams): void {
    const skin = this.groups.skin;
    skin.bmSat.value = f.skinSaturation;
    skin.bmPallor.value = f.skinPallor;
    skin.bmBright.value = f.brightness;

    const face = this.groups.face;
    face.bmSat.value = f.skinSaturation;
    face.bmPallor.value = f.skinPallor * 0.8;
    face.bmBright.value = f.brightness;

    for (const c of ['hair', 'cloth', 'other'] as const) {
      const g = this.groups[c];
      g.bmSat.value = f.saturation;
      g.bmPallor.value = 0;
      g.bmBright.value = f.brightness;
    }
    const eye = this.groups.eye;
    eye.bmSat.value = f.saturation * (1 - 0.45 * f.irisDim);
    eye.bmPallor.value = 0.25 * f.irisDim;
    eye.bmBright.value = f.brightness * (1 - 0.3 * f.irisDim);
  }
}
