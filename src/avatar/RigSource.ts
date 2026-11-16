import type { Object3D } from 'three';
import type { VRM, VRMExpressionManager, VRMHumanoid, VRMLookAt } from '@pixiv/three-vrm';
import type { ModelMeta } from './meta';

export type RigKind = 'vrm0' | 'vrm1' | 'glb' | 'placeholder';

/** 统一的模型接口：VRM、普通 GLB、占位模型都转换成这个结构，后续模块不关心模型来源。 */
export interface RigSource {
  kind: RigKind;
  scene: Object3D;
  humanoid: VRMHumanoid;
  expressions: VRMExpressionManager;
  lookAt: VRMLookAt | null;
  meta: ModelMeta;
  /** 每帧：normalized 骨骼 → 原始骨骼、表情、视线、弹簧骨骼。 */
  update(dt: number): void;
  dispose(): void;
  vrm?: VRM;
  /** 加载阶段产生的提示（例如 GLB 骨骼按名称猜测）。 */
  notes: string[];
}
