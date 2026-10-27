"""Bounded observations for the original tools; never proof or persisted history."""
import json
from .contracts import CAPABILITY_VERIFIERS

ERRORS = {
    'execution_timeout': 'Tempo de execução excedido; resultado do objetivo não comprovado.',
    'execution_cancelled': 'Execução interrompida; resultado do objetivo não comprovado.',
    'execution_invalidated': 'Execução invalidada por alteração de acesso ou módulo.',
    'module_unavailable': 'Módulo desativado ou indisponível.',
    'invalid_input': 'Argumentos inválidos para a ferramenta.',
    'duplicate_invocation': 'Chamada duplicada bloqueada; ação não repetida.',
    'permission_denied': 'Permissão operacional indisponível.',
    'execution_failed': 'A ferramenta não devolveu uma observação válida.'
}


def bounded(value, limit):
    if not isinstance(value, str): return ''
    return value if len(value) <= limit else value[:limit] + '… [saída truncada]'


def diagnostic(observation):
    capability = observation.get('capabilityId')
    verifier = CAPABILITY_VERIFIERS.get(capability)
    if verifier in ('reminder_read', 'reminder_write'):
        if observation.get('status') != 'succeeded' or not any(item.get('kind') == verifier and item.get('verified') is True for item in observation.get('evidence', [])):
            return 'A operação de lembretes não teve resultado confirmado.'
        data = observation.get('data', {})
        if not isinstance(data, dict) or not isinstance(data.get('items'), list): return ''
        labels = {'reminder_create': 'Lembrete criado', 'reminder_update': 'Lembrete atualizado', 'reminder_delete': 'Lembrete excluído',
                  'reminder_complete': 'Ocorrência concluída', 'reminder_snooze': 'Ocorrência adiada', 'reminder_get': 'Lembrete consultado', 'reminder_list': 'Lembretes encontrados'}
        parts = [labels[capability] + '.']
        affected = data.get('affectedOccurrence')
        if isinstance(affected, dict):
            parts.append('Ocorrência original: ' + bounded(affected.get('nominalLocalTime'), 19) + '.')
            if capability == 'reminder_snooze': parts.append('Adiada para UTC: ' + bounded(affected.get('snoozedUntilUtc'), 32) + '.')
        for item in data['items'][:100]:
            if not isinstance(item, dict): continue
            parts.append(bounded(item.get('title'), 200) + ('; próximo aviso UTC: ' + bounded(item.get('nextDueUtc'), 32) if item.get('nextDueUtc') else '') + '; fuso: ' + bounded(item.get('timeZone'), 160) + '.')
        if not data['items']: parts.append('Nenhum lembrete encontrado.')
        if data.get('nextCursor'): parts.append('Há mais resultados na próxima página.')
        return bounded(' '.join(parts), 6000)
    if capability not in ('run_powershell', 'gui_action', 'control_system_volume', 'capture_screen_base64', 'get_system_telemetry'):
        return ''
    raw = observation.get('data')
    if capability == 'capture_screen_base64':
        # Never include image bytes, even if JSON-like, in the textual summary.
        return 'Dados de imagem recebidos pela ferramenta de captura.' if isinstance(raw, str) and raw else ERRORS.get(observation.get('errorCode'), 'Captura sem dados disponíveis.')
    try: data = json.loads(raw) if isinstance(raw, str) else raw
    except (ValueError, TypeError): data = None
    if not isinstance(data, dict):
        return ERRORS.get(observation.get('errorCode'), 'Sem observação disponível para esta etapa.')
    if capability == 'run_powershell':
        parts = []
        code = data.get('returncode')
        if type(code) is int: parts.append(f'PowerShell terminou com código {code}.')
        if data.get('stdout'): parts.append('Saída:\n' + bounded(data['stdout'], 4000))
        if data.get('stderr'): parts.append('Erro do comando:\n' + bounded(data['stderr'], 2000))
        if data.get('error'): parts.append('Erro da ferramenta: ' + bounded(data['error'], 1000))
        return '\n'.join(parts) or ERRORS.get(observation.get('errorCode'), 'PowerShell sem saída disponível.')
    if data.get('status') == 'error': return 'Erro da ferramenta: ' + bounded(data.get('error'), 1000)
    if capability == 'gui_action' and data.get('status') == 'ok':
        return 'Comando de mouse/teclado enviado: ' + bounded(data.get('action'), 40) + '. O objetivo visual não foi comprovado.'
    if capability == 'control_system_volume' and data.get('status') == 'ok':
        parts = []
        volume = data.get('volume_percent')
        if type(volume) in (int, float) and 0 <= volume <= 100: parts.append(f'Volume informado: {volume}%.')
        if type(data.get('muted')) is bool: parts.append('Silenciado.' if data['muted'] else 'Áudio não silenciado.')
        return ' '.join(parts) or 'Comando de volume enviado.'
    return ERRORS.get(observation.get('errorCode'), '')
