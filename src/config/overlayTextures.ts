import type { OverlayTextureKey } from '../avatar/textures';

/**
 * 自定义疲惫贴图（可选）。
 * 把透明 PNG 放进 public/fatigue/ 目录，然后在这里填写相对路径，例如：
 *   cloud: 'fatigue/cloud.png',
 *   foreheadLines: 'fatigue/forehead_lines.png',
 * 留空的项使用程序化绘制的默认图案。
 */
export const OVERLAY_TEXTURE_OVERRIDES: Partial<Record<OverlayTextureKey, string>> = {
  // cloud: 'fatigue/cloud.png',
};
