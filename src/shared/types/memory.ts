export interface MemoryItem {
  id: string
  fact: string
  createdAt: string
}

export interface JasperMemory {
  installationId?: string
  updatedAt?: string
  userName: string
  userPreferences: string[]
  facts: MemoryItem[]
}
