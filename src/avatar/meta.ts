import type { VRM } from '@pixiv/three-vrm';

export interface ModelMeta {
  title: string;
  author: string;
  version: string;
  specVersion: string;
  /** 授权相关字段，原样展示给研究者核对。 */
  license: { label: string; value: string }[];
  fileName: string;
}

export function readVrmMeta(vrm: VRM, fileName: string): ModelMeta {
  const meta = vrm.meta as unknown as Record<string, unknown> & { metaVersion?: string };
  const s = (v: unknown) => (v === undefined || v === null || v === '' ? '—' : Array.isArray(v) ? v.join(', ') : String(v));
  if (meta?.metaVersion === '0') {
    return {
      title: s(meta.title),
      author: s(meta.author),
      version: s(meta.version),
      specVersion: 'VRM 0.x',
      fileName,
      license: [
        { label: 'licenseName', value: s(meta.licenseName) },
        { label: 'allowedUserName', value: s(meta.allowedUserName) },
        { label: 'commercialUssageName', value: s(meta.commercialUssageName) },
        { label: 'violentUssageName', value: s(meta.violentUssageName) },
        { label: 'sexualUssageName', value: s(meta.sexualUssageName) },
        { label: 'otherPermissionUrl', value: s(meta.otherPermissionUrl) },
        { label: 'otherLicenseUrl', value: s(meta.otherLicenseUrl) },
        { label: 'contactInformation', value: s(meta.contactInformation) },
      ],
    };
  }
  return {
    title: s(meta?.name),
    author: s(meta?.authors),
    version: s(meta?.version),
    specVersion: 'VRM 1.0',
    fileName,
    license: [
      { label: 'licenseUrl', value: s(meta?.licenseUrl) },
      { label: 'avatarPermission', value: s(meta?.avatarPermission) },
      { label: 'commercialUsage', value: s(meta?.commercialUsage) },
      { label: 'allowRedistribution', value: s(meta?.allowRedistribution) },
      { label: 'modification', value: s(meta?.modification) },
      { label: 'creditNotation', value: s(meta?.creditNotation) },
      { label: 'otherLicenseUrl', value: s(meta?.otherLicenseUrl) },
    ],
  };
}
