/** The picture models offered: Standard (the default) and Maximum quality. */
export type ImageModelId = 'sana' | 'flux';

export const IMAGE_MODELS: Record<ImageModelId, { name: string; maker: string; download: string }> = {
  sana: { name: 'SANA-Sprint 0.6B', maker: 'NVIDIA', download: '≈ 3.1 GB' },
  flux: { name: 'FLUX.2 klein 4B', maker: 'Black Forest Labs', download: '≈ 6.5 GB' },
};
