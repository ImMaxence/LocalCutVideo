/**
 * The AI models the app runs, shown on the home page. Plain data without imports:
 * scripts/seo.mjs reads it too. `key` names the text of landing.ai in the translations.
 */
/** Every model by name: SANA-Sprint reads descriptions through Gemma 2, FLUX.2 through Qwen3. */
export const AI_NAMES = ['Whisper', 'SANA-Sprint', 'Gemma 2', 'FLUX.2 klein', 'Qwen3', 'MediaPipe', 'RNNoise'];

export const AI_MODELS = [
  { key: 'whisper', icon: 'mic', name: 'Whisper', maker: 'OpenAI', license: 'MIT', size: '40–600 MB', url: 'https://github.com/openai/whisper' },
  { key: 'sana', icon: 'image', name: 'SANA-Sprint 0.6B', maker: 'NVIDIA + Gemma 2 (Google)', license: 'Apache-2.0 + Gemma Terms', size: '3.1 GB', url: 'https://huggingface.co/Efficient-Large-Model/Sana_Sprint_0.6B_1024px_diffusers' },
  { key: 'flux', icon: 'sparkles', name: 'FLUX.2 klein 4B', maker: 'Black Forest Labs + Qwen3 (Alibaba)', license: 'Apache-2.0', size: '6.5 GB', url: 'https://huggingface.co/black-forest-labs/FLUX.2-klein-4B' },
  { key: 'mediapipe', icon: 'face', name: 'MediaPipe', maker: 'Google', license: 'Apache-2.0', size: '0.5 MB', url: 'https://ai.google.dev/edge/mediapipe/solutions/guide' },
  { key: 'rnnoise', icon: 'volume', name: 'RNNoise', maker: 'Xiph.Org, Mozilla', license: 'BSD-3-Clause', size: '5 MB', url: 'https://github.com/xiph/rnnoise' },
];
