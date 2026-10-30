# Gate de proveniência do modelo — alternativa autorizada e validada

Data:30/10/2026. Escopo: plano02, antes de promoção aos consumidores03/04. Não é apenas item de empacotamento.

**Resultado atual:** usuário autorizou avaliar ONNX Community. O manifesto passou a fixar d4c06bf0d7680171ac30042a1387e1fdb7a90021; cinco arquivos,135.135.340bytes, hashes verificados pelo transporte seguro. Model card com licença explícita Apache2 preservado junto ao texto integral e atribuição ao original. Gate real CPU offline384dimensões passou; cache-only sem download passou. O bloqueio específico de proveniência da candidata anterior foi resolvido pela alternativa autorizada. A verificação geral final está em community-verify.log. Os trechos seguintes preservam o histórico da decisão, não descrevem uma escolha ainda pendente.

## Candidata executada

Xenova/paraphrase-multilingual-MiniLM-L12-v2, revisão2c4055b12046f11709e9df2c122e59ffbdc2f900. O runtime4.3.2 passou na auditoria e a inferência CPU offline passou nos testes reais. A conversão referencia o original Apache2, mas não declara licença independente nos metadados examinados. Esse teste técnico não resolve a evidência de permissão exigida pelo plano02. A revisão independente confirmou que o gate deve permanecer aberto. Não publicar a candidata nos consumidores03/04 por inferência sobre a licença.

## Alternativa concreta, somente metadados consultados

Fonte: https://huggingface.co/onnx-community/paraphrase-multilingual-MiniLM-L12-v2-ONNX

- Revisão observada: d4c06bf0d7680171ac30042a1387e1fdb7a90021.
- Model card declara apache-2.0 e identifica o mesmo modelo original,384dimensões.
- onnx/model_int8.onnx:118.049.319bytes, SHA2560029fce9c82365d8a2bf20e03a476e84785a872d8d423c8bac0fd0f350df88dc.
- tokenizer.json:17.082.987bytes, SHA256cad551d5600a84242d0973327029452a1e3672ba6313c2a3c3d69c4310e12719.
- config.json613bytes, tokenizer_config.json1457bytes; demais arquivos necessários, hashes, notificações e total ainda precisam ser revisados.
- Não foi baixada ou testada. Não alegar compatibilidade/qualidade só por compartilhar a arquitetura. Não reutilizar fingerprint/índice da candidata anterior.

## Escolha solicitada

Recomendação: autorizar a avaliação dessa conversão ONNX Community, mantendo Transformers4.3.2, CPU, download sob demanda e os mesmos limites. Atualizar o manifesto fechado somente após autorização, repetir o gate de arquivos/licença/inferência e preservar as evidências da candidata anterior. Alternativa: manter o manifesto atual, sem promoção, até obter esclarecimento de permissão do responsável pela conversão; não enviar mensagem ao autor sem instrução explícita do usuário.

Não trocar repositório, variante, biblioteca, provedor ou tornar rede livre para contornar o gate.
