// Candidate metadata only. Runtime promotion requires the dependency and model gates.
export const SEMANTIC_MODEL_MANIFEST = {
  schemaVersion: 1,
  modelId: 'onnx-community/paraphrase-multilingual-MiniLM-L12-v2-ONNX',
  revision: 'd4c06bf0d7680171ac30042a1387e1fdb7a90021',
  dtype: 'int8', dimensions: 384, pooling: 'mean', normalization: 'l2', maxTokens: 128,
  assets: [
    { path: 'onnx/model_int8.onnx', bytes: 118049319, sha256: '0029fce9c82365d8a2bf20e03a476e84785a872d8d423c8bac0fd0f350df88dc' },
    { path: 'tokenizer.json', bytes: 17082987, sha256: 'cad551d5600a84242d0973327029452a1e3672ba6313c2a3c3d69c4310e12719' },
    { path: 'config.json', bytes: 613, sha256: '376a54b28d37e8502389a87d6c8ff59247fc361cd8d980a47b36b6cae876de5e' },
    { path: 'tokenizer_config.json', bytes: 1457, sha256: '3a8d9bef4da7fc3ac71da789f225b47dc7599a28cfdcc2140463771927dc0726' },
    { path: 'special_tokens_map.json', bytes: 964, sha256: '8c785abebea9ae3257b61681b4e6fd8365ceafde980c21970d001e834cf10835' }
  ]
} as const
