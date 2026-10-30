# Semantic memory candidate — provenance and notices

This candidate is evaluated locally; this notice does not mark the complete commercial release as approved.

- Original: sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2, revision e8f8c211226b894fcb81acc59f3b34ba3efd5f42. The official Hub model metadata declares apache-2.0. Source: https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2/tree/e8f8c211226b894fcb81acc59f3b34ba3efd5f42
- Selected ONNX conversion: onnx-community/paraphrase-multilingual-MiniLM-L12-v2-ONNX, revision d4c06bf0d7680171ac30042a1387e1fdb7a90021. Its model card explicitly declares apache-2.0 and identifies the original model. The exact model card is preserved in semantic-model-card.md (SHA25685bba6e4bf6a155fdf16c7d7f43cb1321c27672e0d29e9d5f0e881feeb6de588); full license text in semantic-model-Apache-2.0.txt. Source: https://huggingface.co/onnx-community/paraphrase-multilingual-MiniLM-L12-v2-ONNX/tree/d4c06bf0d7680171ac30042a1387e1fdb7a90021
- Retired evaluation: Xenova/paraphrase-multilingual-MiniLM-L12-v2 revision2c4055b12046f11709e9df2c122e59ffbdc2f900 lacked an independent model-card license declaration. Its development cache and historical evidence are preserved, but the production manifest no longer accepts that model/revision.
- Local candidate: one int8 ONNX graph, tokenizer.json and three configuration JSON files; exact hashes and sizes are in src/main/memory/semantic/model-manifest.ts. No executable repository scripts are used.
- Runtime: @huggingface/transformers4.3.2, Apache-2.0; full text preserved in transformers-js-LICENSE.txt from the installed exact package.
- Runtime: onnxruntime-node1.30.0, MIT; upstream LICENSE and ThirdPartyNotices.txt preserved as onnxruntime-LICENSE.txt and onnxruntime-ThirdPartyNotices.txt, fetched from https://github.com/microsoft/onnxruntime/tree/v1.30.0 .

The selected conversion now provides the explicit license declaration and upstream attribution required by the stage02 provenance gate. Preserve applicable license/notices during distribution. Runtime package platform selection, sharp/libvips and other transitive notices remain part of the final packaging audit; this is not approval of the entire commercial release. The development cache is not an installer artifact and model weights are not bundled by this change.
