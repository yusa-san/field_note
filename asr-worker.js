/* 端末内での音声書き起こし（Whisper / transformers.js）を行う Web Worker
 * 音声は外部に送らない。モデルは初回だけダウンロードし、ブラウザのキャッシュに残る。
 */
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6";

env.allowLocalModels = false;

let asr = null;
let loadedKey = "";

async function hasWebGPU() {
  try {
    return !!(self.navigator.gpu && (await self.navigator.gpu.requestAdapter()));
  } catch {
    return false;
  }
}

async function load(model, wantGpu) {
  const gpu = wantGpu && (await hasWebGPU());
  const key = `${model}|${gpu}`;
  if (asr && loadedKey === key) return gpu ? "webgpu" : "wasm";
  if (asr) { try { await asr.dispose(); } catch {} asr = null; }
  const progress_callback = (p) => postMessage({ type: "progress", p });
  try {
    asr = await pipeline("automatic-speech-recognition", model, gpu
      ? { device: "webgpu", dtype: { encoder_model: "fp32", decoder_model_merged: "q4" }, progress_callback }
      : { device: "wasm", dtype: "q8", progress_callback });
  } catch (e) {
    if (!gpu) throw e;
    // GPU で動かなければ CPU で
    asr = await pipeline("automatic-speech-recognition", model, { device: "wasm", dtype: "q8", progress_callback });
    loadedKey = `${model}|false`;
    return "wasm";
  }
  loadedKey = key;
  return gpu ? "webgpu" : "wasm";
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === "load") {
      const device = await load(m.model, m.gpu);
      postMessage({ type: "ready", id: m.id, device });
    } else if (m.type === "run") {
      const out = await asr(m.pcm, { language: "japanese", task: "transcribe", chunk_length_s: 30 });
      postMessage({ type: "result", id: m.id, text: (out.text || "").trim() });
    }
  } catch (err) {
    postMessage({ type: "error", id: m.id, message: String(err && err.message || err) });
  }
};
