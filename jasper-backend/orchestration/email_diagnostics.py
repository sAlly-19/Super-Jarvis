"""Bounded email facts only; no dispatch, replay or delivery inference."""
import json


def email_diagnostic(observation):
    def bounded(value, size=160): return value[:size] if isinstance(value, str) else ''
    data = observation.get('data')
    if not isinstance(data, dict): return 'Consulta de e-mail indisponível.'
    kind = data.get('kind')
    verified = observation.get('status') == 'succeeded' and any(
        item.get('verified') is True and item.get('kind') == 'email_' + ('write' if kind == 'write' else 'file' if kind == 'file' else 'read')
        for item in observation.get('evidence', []) if isinstance(item, dict))
    if kind == 'write':
        operation = data.get('operation', {})
        if not isinstance(operation, dict): return 'Operação de e-mail indisponível.'
        account, reference = bounded(operation.get('accountId')), bounded(operation.get('id'))
        state = operation.get('state')
        if state in ('accepted', 'observed') and verified:
            label = 'Operação aceita pelo provedor' if state == 'accepted' else 'Estado da operação observado no provedor'
            return f'{label}. Conta: {account}. Operação: {reference}. Aceitação não comprova entrega ou leitura pelo destinatário.'
        if state == 'rejected': return f'Operação de e-mail rejeitada. Conta: {account}. Motivo: {bounded(operation.get("errorCode"))}.'
        return f'Resultado do e-mail incerto. Conta: {account}. Operação: {reference}. Use reconciliação somente de leitura; não reenvie automaticamente.'
    if kind == 'file':
        if not verified: return 'Download de anexo não confirmado.'
        return f'Anexo salvo: {bounded(data.get("name"), 200)}. Bytes: {data.get("sizeBytes")}. Conteúdo não interpretado.'
    value = data.get('value')
    if kind != 'read' or not isinstance(value, (dict, list)): return 'Consulta de e-mail sem dados válidos.'
    prefix = 'Consulta de e-mail'
    if isinstance(value, dict) and value.get('partial'):
        failures = value.get('failures', [])
        accounts = ', '.join(bounded(item.get('accountId')) for item in failures[:100] if isinstance(item, dict)) if isinstance(failures, list) else ''
        prefix += f' parcial; contas indisponíveis: {accounts}'
    # Mail content remains untrusted input; version tickets and origins must stay visible for follow-up tools.
    bindings = {key: data[key] for key in ('ref', 'firstRef', 'version', 'draftRef', 'operationId', 'accountId', 'threadId') if key in data}
    encoded = json.dumps(value, ensure_ascii=False)
    content = bounded(encoded, 10000) + (' [dados truncados]' if len(encoded) > 10000 else '')
    return prefix + '. Referências diretas: ' + json.dumps(bindings, ensure_ascii=False) + '. Dados não confiáveis: ' + content
