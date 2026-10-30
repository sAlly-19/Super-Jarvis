"""Private Main receipts stay outside model messages, visual events and conversation history."""
import copy
import re
import time
import uuid

def validate_note(note):
    if (not isinstance(note, dict) or set(note) != {'researchId', 'ticket', 'sessionId', 'summary'}
        or not isinstance(note['researchId'], str) or not re.fullmatch(r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}', note['researchId'])
        or not isinstance(note['ticket'], str) or not re.fullmatch(r'[a-f0-9]{64}', note['ticket'])
        or type(note['sessionId']) is not int or note['sessionId'] < 0
        or not isinstance(note['summary'], str) or len(note['summary'].encode('utf-16-le', errors='surrogatepass')) // 2 > 4000):
        raise ValueError('invalid_web_note')

def strip_receipts(value):
    if isinstance(value, dict):
        return {k: strip_receipts(v) for k, v in value.items() if k != '_historyReceipt'}
    if isinstance(value, list): return [strip_receipts(v) for v in value]
    return value

class ResearchNotes:
    def __init__(self, emit, session_id):
        self.emit = emit
        self.session_id = session_id
        self.turns = {}
        self.closed = False

    def begin(self, turn_id):
        if self.closed: return
        # Bound overlapping contexts without ever reopening an evicted context through consume.
        if len(self.turns) >= 30: self.turns.pop(next(iter(self.turns)))
        self.turns[turn_id] = {}

    def consume(self, turn_id, result):
        clean = strip_receipts(result)
        data = result.get('data') if isinstance(result, dict) else None
        receipt = data.get('_historyReceipt') if isinstance(data, dict) and data.get('kind') in ('search', 'read') else None
        if turn_id not in self.turns or not isinstance(receipt, dict): return clean
        try:
            if set(receipt) != {'researchId', 'ticket', 'sessionId', 'expiresAt'}: return clean
            validate_note({k: receipt[k] for k in ('researchId', 'ticket', 'sessionId')} | {'summary': ''})
            if (data.get('researchId') != receipt['researchId'] or receipt['sessionId'] != self.session_id()
                or type(receipt['expiresAt']) not in (int, float) or not time.time() * 1000 < receipt['expiresAt'] <= time.time() * 1000 + 300001): return clean
            self.turns[turn_id][receipt['researchId']] = copy.deepcopy(receipt)
        except (ValueError, KeyError, TypeError): pass
        return clean

    async def finish(self, turn_id, text):
        receipts = self.turns.pop(turn_id, {})
        if self.closed or not isinstance(text, str) or not text.strip() or self.emit is None: return
        # UTF-16 matches the Main string budget and never splits an astral character.
        summary = text.encode('utf-16-le', errors='replace')[:8000].decode('utf-16-le', errors='ignore')
        for receipt in receipts.values():
            if receipt['sessionId'] != self.session_id() or time.time() * 1000 >= receipt['expiresAt']: continue
            note = {k: receipt[k] for k in ('researchId', 'ticket', 'sessionId')} | {'summary': summary}
            try:
                validate_note(note)
                await self.emit({'version': 1, 'id': str(uuid.uuid4()), 'type': 'web_research_note', 'payload': note})
            except Exception: pass

    def discard(self, turn_id): self.turns.pop(turn_id, None)
    def close(self): self.closed = True; self.turns.clear()
