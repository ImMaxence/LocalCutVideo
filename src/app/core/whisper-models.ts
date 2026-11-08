/**
 * Whisper models on Hugging Face, each pinned to a commit: a change upstream never reaches the
 * app unnoticed. To update a model, take the new `sha` of
 * https://huggingface.co/api/models/<repo>.
 */
export const WHISPER_REPOS = {
  tiny: { repo: 'onnx-community/whisper-tiny_timestamped', revision: '517244293732ee2d58139af5814231b7e6830a0d' },
  base: { repo: 'onnx-community/whisper-base_timestamped', revision: '608c49e61301901684bc36cac8f74b95ff6b5a8e' },
  small: { repo: 'onnx-community/whisper-small_timestamped', revision: '65caa70f294b46e1c33ff820aae6b16d048ab818' },
};
