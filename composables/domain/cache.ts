export const buildDomainCheckCacheKey = (
  domainName: string,
  selectedTLDs: string[],
  verifyWithRdap: boolean
): { cacheKey: string, normalizedDomain: string, sortedTLDs: string[] } => {
  const normalizedDomain = domainName.trim().toLowerCase()
  const sortedTLDs = Array.from(new Set(selectedTLDs.map(tld => tld.toLowerCase()))).sort()
  const cacheKey = `${normalizedDomain}:${sortedTLDs.join(',')}:rdap=${verifyWithRdap ? '1' : '0'}`

  return { cacheKey, normalizedDomain, sortedTLDs }
}
