import { isAbsolute } from 'node:path'
import type { FeatureExtractionPipeline, Tensor } from '@huggingface/transformers'
import { Socket } from 'node:net'
import { SEMANTIC_MODEL_MANIFEST } from './model-manifest'
import { MODEL_FINGERPRINT, handleModelRequest } from './model-protocol'
import { verifyModelAssets } from './model-files'

// This process is offline before importing the runtime. IPC does not use a network socket.
Socket.prototype.connect = function () { throw new Error('model_network_disabled') }
globalThis.fetch = async () => { throw new Error('model_network_disabled') }
const root = process.argv[2], fingerprint = process.argv[3]
let extractor: Promise<{ model: FeatureExtractionPipeline; mean: typeof import('@huggingface/transformers').mean_pooling }> | undefined
async function load() {
  if (!root || !isAbsolute(root) || fingerprint !== MODEL_FINGERPRINT) throw new Error('model_not_prepared')
  if (!extractor) {
    extractor = (async () => {
      const scope = { signal: new AbortController().signal, deadline: Date.now() + 20000, check() {} }
      if (!await verifyModelAssets(root, SEMANTIC_MODEL_MANIFEST.assets, scope)) throw new Error('model_not_prepared')
      const { env, pipeline, mean_pooling } = await import('@huggingface/transformers')
      env.allowRemoteModels = false; env.allowLocalModels = true
      env.useBrowserCache = false; env.useFSCache = false; env.useWasmCache = false; env.logLevel = 50
      if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = {}
      const model = await pipeline('feature-extraction', root, { device: 'cpu', dtype: 'int8', local_files_only: true })
      return { model, mean: mean_pooling }
    })()
    // Keep rejection until an explicit new worker is started; no silent retry or download.
  }
  return extractor
}
let busy = false
process.parentPort?.on('message', event => {
  if (busy) { process.exit(1); return }
  busy = true
  void handleModelRequest(event.data, {
    async embed(texts) {
      const { model, mean } = await load()
      const inputs = model.tokenizer(texts, { padding: true, truncation: true, max_length: SEMANTIC_MODEL_MANIFEST.maxTokens })
      const output = await model.model(inputs)
      return mean(output.last_hidden_state as Tensor, inputs.attention_mask).normalize(2, -1).tolist() as number[][]
    },
    async count(texts) { const { model } = await load(); return texts.map(text => model.tokenizer.encode(text, { add_special_tokens: true }).length) }
  }).then(result => { busy = false; process.parentPort?.postMessage(result) }, () => { process.exit(1) })
})
