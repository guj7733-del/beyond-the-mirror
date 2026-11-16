import { Group, Mesh, MeshBasicMaterial, MeshToonMaterial, PlaneGeometry, Vector3, type Object3D } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/** 角色手里的手机（Stage 1–4 双手捧着）。位置每帧取两只手中间，屏幕朝向眼睛。 */
export class PhoneProp {
  readonly root = new Group();
  private readonly body: Mesh;
  private readonly screen: Mesh;
  private readonly extras: Mesh[];
  private readonly mid = new Vector3();
  private readonly l = new Vector3();
  private readonly r = new Vector3();
  private readonly eye = new Vector3();
  private readonly up = new Vector3();
  /** 可调参数：沿躯干向上 / 向前的偏移（米），手机尺寸倍数，屏幕朝向（0 = 正对眼睛，1 = 竖直朝后）。 */
  readonly tune = { up: 0.05, forward: 0.025, size: 1.25, upright: 0.45 };

  constructor(
    private readonly leftHand: Object3D,
    private readonly rightHand: Object3D,
    private readonly eyeTarget: Object3D,
    private readonly scale: number,
  ) {
    const s = scale;
    this.body = new Mesh(
      new RoundedBoxGeometry(0.072 * s, 0.145 * s, 0.009 * s, 3, 0.008 * s),
      new MeshToonMaterial({ color: 0x2b2d33, transparent: true }),
    );
    this.screen = new Mesh(
      new PlaneGeometry(0.064 * s, 0.134 * s),
      new MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, toneMapped: false }),
    );
    this.screen.position.z = 0.0047 * s;
    // 背面摄像头模组（从镜头方向看到的是手机背面）
    const bump = new Mesh(
      new RoundedBoxGeometry(0.026 * s, 0.026 * s, 0.003 * s, 2, 0.006 * s),
      new MeshToonMaterial({ color: 0x3c3f47, transparent: true }),
    );
    bump.position.set(0.018 * s, 0.05 * s, -0.0055 * s);
    const lens = new Mesh(new PlaneGeometry(0.008 * s, 0.008 * s), new MeshBasicMaterial({ color: 0x111216, transparent: true }));
    lens.position.set(0.018 * s, 0.054 * s, -0.0072 * s);
    lens.rotation.y = Math.PI;
    this.extras = [bump, lens];
    this.root.add(this.body, this.screen, bump, lens);
    this.root.userData.bmOverlay = true;
    this.body.userData.bmOverlay = true;
    this.screen.userData.bmOverlay = true;
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const m of [this.body, this.screen, ...this.extras]) {
      m.geometry.dispose();
      (m.material as MeshBasicMaterial).dispose();
    }
  }

  update(weight: number, brightness: number): void {
    const w = Math.max(0, Math.min(1, weight));
    this.root.visible = w > 0.02;
    if (!this.root.visible) return;
    (this.body.material as MeshToonMaterial).opacity = w;
    for (const e of this.extras) (e.material as MeshBasicMaterial).opacity = w;
    const sm = this.screen.material as MeshBasicMaterial;
    sm.opacity = w;
    sm.color.setRGB(0.75 * brightness, 0.9 * brightness, 1.0 * brightness);
    this.leftHand.getWorldPosition(this.l);
    this.rightHand.getWorldPosition(this.r);
    this.mid.copy(this.l).add(this.r).multiplyScalar(0.5);
    const parent = this.root.parent;
    this.eyeTarget.getWorldPosition(this.eye);
    // 躯干“向上”方向：从两手中点指向眼睛的方向与竖直方向的折中
    const toEye = this.eye.clone().sub(this.mid).normalize();
    this.up.set(0, 1, 0).lerp(toEye, 0.5).normalize();
    const fwd = new Vector3(0, 0, 1);
    this.mid.addScaledVector(this.up, this.tune.up * this.scale).addScaledVector(fwd, this.tune.forward * this.scale);
    // 屏幕朝向：在“正对眼睛”和“竖直朝后”之间插值
    const look = this.eye.clone().sub(this.mid).normalize().lerp(new Vector3(0, 0.15, -1).normalize(), this.tune.upright).normalize();
    const target = this.mid.clone().add(look);
    if (parent) {
      parent.worldToLocal(this.mid);
    }
    this.root.position.copy(this.mid);
    this.root.scale.setScalar((0.6 + 0.4 * w) * this.tune.size);
    this.root.lookAt(target);
  }
}
