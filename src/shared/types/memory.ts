export interface MemoryItem {
  id: string
  fact: string
  createdAt: string
}

export interface JasperMemory {
  userName: string
  userPreferences: string[]
  facts: MemoryItem[]
}

