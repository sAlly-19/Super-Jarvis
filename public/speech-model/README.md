# Speech Commands base model

Local copy of TensorFlow.js Speech Commands v0.5, browser FFT, 18w vocabulary.

Upstream: https://storage.googleapis.com/tfjs-models/tfjs/speech-commands/v0.5/browser_fft/18w/

Model implementation and documentation: https://github.com/tensorflow/tfjs-models/tree/master/speech-commands

`scripts/setup-speech-assets.mjs` verifies SHA-256 checksums of metadata,
topology and both weight shards before development and distribution builds.
All four files must ship together so voice calibration works offline.
