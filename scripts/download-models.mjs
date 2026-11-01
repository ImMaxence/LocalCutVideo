// Downloads the Whisper models used by the app, so the site serves them itself and visitors
// never contact Hugging Face. Already complete files are skipped, so it can run again safely.
//
//   node scripts/download-models.mjs [--out public/models] [--models tiny,base,small]
//
// The Docker build runs it (build argument WHISPER_MODELS). Writes <out>/manifest.json last,
// which tells the app which models are available here.
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const out = path.resolve(arg('out', 'public/models'));
const models = arg('models', process.env.WHISPER_MODELS || 'tiny,base,small')
  .split(',')
  .map((m) => m.trim())
  .filter((m) => ['tiny', 'base', 'small'].includes(m));

// Configuration and tokenizer, plus the weights the app loads: fp32 / fp16 encoder and q4
// decoder on WebGPU, 8-bit encoder and decoder on WebAssembly.
const FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'added_tokens.json',
  'normalizer.json',
  'vocab.json',
  'merges.txt',
  'onnx/encoder_model.onnx',
  'onnx/encoder_model_fp16.onnx',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_q4.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
];

async function size(file) {
  try {
    return (await stat(file)).size;
  } catch {
    return -1;
  }
}

async function download(repo, file) {
  const target = path.join(out, repo, file);
  const url = `https://huggingface.co/${repo}/resolve/main/${file}`;
  const head = await fetch(url, { method: 'HEAD' });
  if (!head.ok) throw new Error(`${url}: ${head.status}`);
  const expected = Number(head.headers.get('content-length') ?? -1);
  if (expected > 0 && (await size(target)) === expected) return 'kept';
  await mkdir(path.dirname(target), { recursive: true });
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`${url}: ${response.status}`);
  const partial = `${target}.part`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  await rename(partial, target);
  return `${((await size(target)) / 1e6).toFixed(1)} MB`;
}

const manifestFile = path.join(out, 'manifest.json');
const available = new Set(JSON.parse(await readFile(manifestFile, 'utf8').catch(() => '{"models":[]}')).models);
for (const model of models) {
  const repo = `onnx-community/whisper-${model}_timestamped`;
  for (const file of FILES) console.log(`${repo}/${file}: ${await download(repo, file)}`);
  available.add(model);
  await writeFile(manifestFile, JSON.stringify({ models: [...available].sort(), updatedAt: new Date().toISOString() }, null, 2));
}
console.log(`Whisper models served from ${out}: ${[...available].join(', ') || 'none'}`);
