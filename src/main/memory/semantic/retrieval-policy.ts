export interface RetrievalPolicy { minCosine: number; semanticWeight: number; textWeight: number }
export const RETRIEVAL_POLICY: Readonly<RetrievalPolicy> = Object.freeze({ minCosine: 0.55, semanticWeight: 0.75, textWeight: 0.25 })
export const STOPWORDS = new Set(('a ao aos as o os um uma uns umas de da das do dos e em na nas no nos para por com sem que qual quais quem como onde quando quanto quantos qual é sao ser estar está esta esse essa isso eu meu meus minha minhas voce seu sua seus suas me se gosto gostaria pode poderia por favor sobre utilizo uso prefiro').split(' '))
export const normalizeSearchText = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
export function informativeTokens(text: string): string[] {
  return [...new Set((normalizeSearchText(text).match(/[\p{L}\p{N}_-]+/gu) ?? []).filter(token => token.length > 1 && !STOPWORDS.has(token)))]
}
