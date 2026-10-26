def task_summary(result):
    labels = {'succeeded': 'Tarefa verificada.', 'partial': 'Tarefa parcialmente verificada.',
              'unknown': 'Resultado desconhecido. Não vou repetir ações automaticamente.',
              'failed': 'Não foi possível concluir a tarefa.', 'cancelled': 'Tarefa cancelada.'}
    parts = [labels[result['status']]]
    for observation in result.get('results', {}).values():
        if observation.get('status') == 'succeeded' and any(item.get('verified') is True and item.get('kind') == 'telemetry_read' for item in observation.get('evidence', [])):
            data = observation.get('data', {})
            parts.append(f"CPU: {data['cpu_percent']}%. RAM: {data['ram']['percent']}%. Disco C: {data['disk_c']['percent']}%.")
    return ' '.join(parts)


class Verification:
    @staticmethod
    def verify(step, result):
        if result.get('status') in ('failed', 'cancelled'): return result['status']
        # Only host-verified observations count. LLM prose and exit status do not.
        verifier = step['successCriterion']['verifierId']
        if verifier != 'none' and result.get('status') == 'succeeded' and any(
                item.get('verified') is True and item.get('kind') == verifier for item in result.get('evidence', [])):
            return 'succeeded'
        return 'unknown'
