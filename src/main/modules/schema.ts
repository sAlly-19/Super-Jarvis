import type { ModuleSchema, SchemaType } from '../../shared/types/modules'

const TYPES = new Set(['object', 'array', 'string', 'integer', 'number', 'boolean', 'null'])
const KEYS = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum',
  'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'description'])
const plain = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object'
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)

export function assertSchema(schema: unknown, depth = 0): asserts schema is ModuleSchema {
  if (depth > 32 || !plain(schema) || Object.keys(schema).some(key => !KEYS.has(key))) throw new Error('invalid_schema')
  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  if (!types.length || types.some(type => typeof type !== 'string' || !TYPES.has(type))) throw new Error('invalid_schema')
  if (schema.properties !== undefined) {
    if (!types.includes('object') || !plain(schema.properties)) throw new Error('invalid_schema')
    for (const child of Object.values(schema.properties)) assertSchema(child, depth + 1)
  }
  if (schema.required !== undefined && (!Array.isArray(schema.required)
    || schema.required.some(key => typeof key !== 'string' || !plain(schema.properties) || !Object.hasOwn(schema.properties, key)))) throw new Error('invalid_schema')
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') throw new Error('invalid_schema')
  if (schema.items !== undefined) assertSchema(schema.items, depth + 1)
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.length
    || schema.enum.some(value => value !== null && !['string', 'number', 'boolean'].includes(typeof value)))) throw new Error('invalid_schema')
  for (const key of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']) {
    if (schema[key] !== undefined && (typeof schema[key] !== 'number' || !Number.isFinite(schema[key]))) throw new Error('invalid_schema')
  }
}

function matches(type: SchemaType, value: unknown): boolean {
  if (type === 'null') return value === null
  if (type === 'object') return plain(value)
  if (type === 'array') return Array.isArray(value)
  if (type === 'integer') return typeof value === 'number' && Number.isSafeInteger(value)
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  return typeof value === type
}

export function validateValue(schema: ModuleSchema, value: unknown, depth = 0): void {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  if (depth > 32 || !types.some(type => matches(type, value))) throw new Error('invalid_value')
  if (schema.enum && !schema.enum.some(item => item === value)) throw new Error('invalid_enum')
  if (typeof value === 'number' && ((schema.minimum !== undefined && value < schema.minimum)
    || (schema.maximum !== undefined && value > schema.maximum))) throw new Error('invalid_range')
  if (typeof value === 'string' && ((schema.minLength !== undefined && value.length < schema.minLength)
    || (schema.maxLength !== undefined && value.length > schema.maxLength))) throw new Error('invalid_length')
  if (Array.isArray(value)) {
    if ((schema.minItems !== undefined && value.length < schema.minItems)
      || (schema.maxItems !== undefined && value.length > schema.maxItems)) throw new Error('invalid_length')
    if (schema.items) for (const item of value) validateValue(schema.items, item, depth + 1)
  } else if (plain(value)) {
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) throw new Error('missing_field')
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties && Object.hasOwn(schema.properties, key)) validateValue(schema.properties[key], item, depth + 1)
      else if (schema.additionalProperties === false) throw new Error('unknown_field')
    }
  }
}
