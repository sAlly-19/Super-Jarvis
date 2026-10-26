"""Project canonical tools onto Gemini's OpenAPI parameter surface.

This is a provider description only; Main still validates the original schema.
"""
import copy


def _parameters(schema):
    projected = copy.deepcopy(schema)
    projected.pop('additionalProperties', None)
    if isinstance(projected.get('properties'), dict):
        projected['properties'] = {name: _parameters(value) for name, value in projected['properties'].items()}
    if isinstance(projected.get('items'), dict):
        projected['items'] = _parameters(projected['items'])
    return projected


def gemini_function_declarations(tools):
    declarations = []
    for tool in tools:
        if tool.get('type') != 'function' or not tool.get('function'):
            continue
        declaration = copy.deepcopy(tool['function'])
        if 'parameters' in declaration:
            declaration['parameters'] = _parameters(declaration['parameters'])
        declarations.append(declaration)
    return declarations
