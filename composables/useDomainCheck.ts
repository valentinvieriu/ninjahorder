import { ref, reactive, computed } from 'vue'
import { namecheapTLDs } from '~/utils/tlds'

export enum DomainAvailabilityStatus {
  AVAILABLE = 'available',     // High confidence: NXDOMAIN from multiple providers
  REGISTERED = 'registered',   // High confidence: NOERROR/NS/SOA found on at least one provider
  INDETERMINATE = 'indeterminate', // Conflicting results, wildcard detected, or other ambiguity
  ERROR = 'error'              // Network error, DNS error (SERVFAIL), timeout
}

interface DomainResult {
  domain: string
  status: DomainAvailabilityStatus
  error: boolean
  link: string
  confidenceReasons: string[]
  dnssecValidated?: boolean
  wildcardDetected?: boolean
}

// Define the DoH JSON response interface
interface DoHJsonResponse {
  Status: number
  TC: boolean
  RD: boolean
  RA: boolean
  AD: boolean
  CD: boolean
  Question: {
    name: string
    type: number
  }[]
  Answer?: {
    name: string
    type: number
    TTL: number
    data: string
  }[]
  Authority?: {
    name: string
    type: number
    TTL: number
    data: string
  }[]
  Additional?: {
    name: string
    type: number
    TTL: number
    data: string
  }[]
  Comment?: string
}

interface CacheEntry {
  results: DomainResult[]
  timestamp: number
}

interface GroupedResults {
  available: DomainResult[]
  notAvailable: DomainResult[]
  other: DomainResult[] // For INDETERMINATE and ERROR statuses
}

const DOH_PROVIDERS = [
  'https://cloudflare-dns.com/dns-query', // Provider 0
  'https://dns.quad9.net:5053/dns-query', // Provider 1
]

// Configuration for different DNS providers
const providerConfig: Record<string, {
  formatUrl: (domain: string, type: string) => string;
  headers: Record<string, string>;
}> = {
  'cloudflare-dns.com': {
    formatUrl: (domain: string, type: string) => 
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${type}`,
    headers: { 'Accept': 'application/dns-json' }
  },
  'dns.quad9.net:5053': {
    formatUrl: (domain: string, type: string) => 
      `https://dns.quad9.net:5053/dns-query?name=${encodeURIComponent(domain)}&type=${type}`,
    headers: { 'Accept': 'application/dns-json' }
  }
}

const TIMEOUT_MS = 5000 // 5 seconds timeout

export const useDomainCheck = () => {
  const results = reactive<DomainResult[]>([])
  const progress = ref(0)
  const isChecking = ref(false)
  const cache = ref<Record<string, CacheEntry>>({})
  let currentProviderIndex = 0

  const groupedResults = computed<GroupedResults>(() => ({
    available: results.filter(result => result.status === DomainAvailabilityStatus.AVAILABLE),
    notAvailable: results.filter(result => result.status === DomainAvailabilityStatus.REGISTERED),
    other: results.filter(result => result.status === DomainAvailabilityStatus.INDETERMINATE || result.status === DomainAvailabilityStatus.ERROR)
  }))

  const getNextProvider = () => {
    const provider = DOH_PROVIDERS[currentProviderIndex]
    currentProviderIndex = (currentProviderIndex + 1) % DOH_PROVIDERS.length
    return provider
  }

  const fetchWithTimeout = async (url: string, options: RequestInit, timeout: number) => {
    const controller = new AbortController()
    const id = setTimeout(() => controller.abort(), timeout)
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      })
      clearTimeout(id)
      return response
    } catch (error) {
      clearTimeout(id)
      throw error
    }
  }

  const checkDomains = async (domainName: string, selectedTLDs: string[]) => {
    const cacheKey = `${domainName}:${selectedTLDs.join(',')}`
    const cachedEntry = cache.value[cacheKey]

    if (cachedEntry && Date.now() - cachedEntry.timestamp < 5 * 60 * 1000) { // 5 minutes cache
      results.splice(0, results.length, ...cachedEntry.results)
      return groupedResults.value
    }

    results.splice(0, results.length) // Clear previous results
    progress.value = 0
    isChecking.value = true

    const totalDomains = selectedTLDs.length

    for (const tld of selectedTLDs) {
      const fullDomain = `${domainName}${tld}`
      try {
        const response = await checkDomainAvailability(fullDomain)
        results.push(response)
      } catch (error) {
        console.error(`Error checking ${fullDomain}:`, error)
        results.push({
          domain: fullDomain,
          status: DomainAvailabilityStatus.ERROR,
          error: true,
          link: '#',
          confidenceReasons: ['Error in processing domain check.'],
        })
      }
      progress.value = (results.length / totalDomains) * 100
    }

    isChecking.value = false
    
    // Cache the results
    cache.value[cacheKey] = {
      results: [...results],
      timestamp: Date.now()
    }

    return groupedResults.value
  }

  const fetchDnsJson = async (providerUrl: string, domain: string, type: string): Promise<DoHJsonResponse> => {
    // Simplified provider name extraction
    let providerName = 'unknown';
    if (providerUrl.includes('cloudflare-dns.com')) {
      providerName = 'cloudflare-dns.com';
    } else if (providerUrl.includes('dns.quad9.net')) {
      providerName = 'dns.quad9.net:5053';
    }
    
    const config = providerConfig[providerName]
    
    if (!config) {
      throw new Error(`Unknown DNS provider: ${providerName} from URL ${providerUrl}`)
    }
    
    const url = config.formatUrl(domain, type)
    
    try {
      const response = await fetchWithTimeout(url, {
        method: 'GET',
        headers: config.headers
      }, TIMEOUT_MS)
      
      if (!response.ok) {
        console.error(`DoH request failed with status ${response.status} for ${providerUrl}`, {
          url,
          status: response.status,
          statusText: response.statusText
        })
        throw new Error(`DoH request failed with status ${response.status} for ${providerUrl}`)
      }
      
      const data = await response.json() as DoHJsonResponse
      return data
    } catch (error) {
      console.error(`Error fetching DNS data from ${providerUrl}:`, error)
      throw error
    }
  }

  const checkDomainAvailability = async (domain: string): Promise<DomainResult> => {
    // Use Cloudflare (index 0) and Quad9 (index 1)
    const providersToCheck = [DOH_PROVIDERS[0], DOH_PROVIDERS[1]] 
    const confidenceReasons: string[] = []
    
    // Check for wildcard DNS first (uses getNextProvider, will cycle Cloudflare/Quad9)
    const isWildcard = await checkWildcardDNS(domain)
    if (isWildcard) {
      confidenceReasons.push('Wildcard DNS detected. Results may be unreliable.')
    }
    
    // Query NS records from Cloudflare & Quad9 in parallel
    const checkPromises = providersToCheck.map(providerUrl => {
      // Simplified provider name extraction
      let providerName = 'unknown';
      if (providerUrl.includes('cloudflare-dns.com')) providerName = 'cloudflare-dns.com';
      else if (providerUrl.includes('dns.quad9.net')) providerName = 'dns.quad9.net:5053';

      return fetchDnsJson(providerUrl, domain, 'NS')
        .then(data => ({ status: 'fulfilled' as const, value: data, provider: providerName }))
        .catch(error => ({ status: 'rejected' as const, reason: error as Error, provider: providerName }))
    })
    
    const results = await Promise.all(checkPromises)
    
    // Fallback to SOA records if NS failed for Cloudflare & Quad9
    if (results.every(result => result.status === 'rejected')) {
      console.log('All NS queries failed, trying SOA records as fallback with Cloudflare & Quad9')

      const soaPromises = providersToCheck.map(providerUrl => {
        // Simplified provider name extraction
        let providerName = 'unknown';
        if (providerUrl.includes('cloudflare-dns.com')) providerName = 'cloudflare-dns.com';
        else if (providerUrl.includes('dns.quad9.net')) providerName = 'dns.quad9.net:5053';

        return fetchDnsJson(providerUrl, domain, 'SOA')
          .then(data => ({ status: 'fulfilled' as const, value: data, provider: providerName }))
          .catch(error => ({ status: 'rejected' as const, reason: error as Error, provider: providerName }))
      })

      const soaResults = await Promise.all(soaPromises)

      if (soaResults.some(result => result.status === 'fulfilled')) {
        return interpretParallelResults(domain, soaResults, isWildcard)
      }
    }

    // Process NS (or failed SOA) results
    return interpretParallelResults(domain, results, isWildcard)
  }

  const interpretParallelResults = (
    domain: string, 
    providerResults: Array<
      { status: 'fulfilled', value: DoHJsonResponse, provider: string } | 
      { status: 'rejected', reason: Error, provider: string }
    >,
    isWildcard: boolean
  ): DomainResult => {
    const reasons: string[] = []
    let finalStatus: DomainAvailabilityStatus = DomainAvailabilityStatus.ERROR // Default
    let nxDomainCount = 0
    let noErrorCount = 0
    let errorCount = 0
    let dnssecValidated = false
    
    // Add wildcard detection reason if applicable
    if (isWildcard) {
      reasons.push('Wildcard DNS detected. This TLD may return positive results for all queries.')
    }

    providerResults.forEach(result => {
      if (result.status === 'fulfilled') {
        const data = result.value
        reasons.push(`Provider ${result.provider}: Status ${data.Status}`)
        
        if (data.Status === 3) { // NXDOMAIN
          nxDomainCount++
        } else if (data.Status === 0) { // NOERROR
          noErrorCount++
          
          // Check if we have NS records in Answer or Authority sections
          const hasNsRecords = 
            (data.Answer?.some(record => record.type === 2) || 
             data.Authority?.some(record => record.type === 2) ||
             data.Authority?.some(record => record.type === 6)) // SOA records
          
          if (hasNsRecords) {
            reasons.push(`Provider ${result.provider}: Found NS/SOA records.`)
          }
        } else { // Other DNS errors (SERVFAIL etc.)
          errorCount++
          reasons.push(`Provider ${result.provider}: DNS error ${data.Status}`)
        }
        
        if (data.AD) { // Check DNSSEC flag
          dnssecValidated = true
          reasons.push(`Provider ${result.provider}: DNSSEC validated.`)
        }
      } else {
        errorCount++
        reasons.push(`Provider ${result.provider}: Request failed: ${result.reason}`)
      }
    })

    // Determine final status based on counts
    if (noErrorCount > 0) {
      finalStatus = DomainAvailabilityStatus.REGISTERED // Any NOERROR means it likely exists
      reasons.push("At least one provider indicated the domain exists (NOERROR).")
    } else if (nxDomainCount > 0) {
      if (isWildcard) {
        // Wildcard detection makes NXDOMAIN less reliable
        finalStatus = DomainAvailabilityStatus.INDETERMINATE
        reasons.push("Wildcard DNS makes availability determination less reliable.")
      } else if (nxDomainCount === providerResults.length) {
        finalStatus = DomainAvailabilityStatus.AVAILABLE // All providers agree on NXDOMAIN
        reasons.push("All providers confirmed domain not found (NXDOMAIN).")
      } else if (nxDomainCount + errorCount === providerResults.length) {
        // If at least one provider returned NXDOMAIN and no conflicting NOERROR
        // Even with some errors, we can be somewhat confident
        if (nxDomainCount >= 1 && errorCount <= 1) {
          finalStatus = DomainAvailabilityStatus.AVAILABLE
          reasons.push("At least one provider confirmed NXDOMAIN with no conflicting results.")
        } else {
          finalStatus = DomainAvailabilityStatus.INDETERMINATE // Some NXDOMAIN, some errors
          reasons.push("Some providers confirmed NXDOMAIN, others failed. Availability uncertain.")
        }
      }
    } else { // Only errors
      finalStatus = DomainAvailabilityStatus.ERROR
      reasons.push("Could not reliably determine status due to errors.")
    }
    
    // Generate appropriate link based on status
    const link = generateLink(domain, finalStatus)
    
    return {
      domain,
      status: finalStatus,
      error: finalStatus === DomainAvailabilityStatus.ERROR,
      link,
      confidenceReasons: reasons,
      dnssecValidated,
      wildcardDetected: isWildcard
    }
  }

  const generateLink = (domain: string, status: DomainAvailabilityStatus): string => {
    if (status === DomainAvailabilityStatus.REGISTERED) {
      // Ensure protocol is added for valid URL
      return domain.startsWith('http') ? domain : `http://${domain}`;
    } else {
      const tld = '.' + domain.split('.').pop()
      if (tld && namecheapTLDs.includes(tld)) {
        return `https://www.namecheap.com/domains/registration/results/?domain=${domain}`
      }
      return `https://domainr.com/${domain}`
    }
  }

  const checkWildcardDNS = async (domain: string): Promise<boolean> => {
    try {
      const randomSubdomain = Math.random().toString(36).substring(2, 15)
      const wildcardDomain = `${randomSubdomain}.${domain}`
      const provider = getNextProvider() // Uses the rotating provider index
      
      const data = await fetchDnsJson(provider, wildcardDomain, 'A')
      
      // If we get a NOERROR response with records for a random subdomain, it's likely a wildcard
      return data.Status === 0 && ((data.Answer?.length ?? 0) > 0 || (data.Authority?.length ?? 0) > 0)
    } catch (error) {
      console.error(`Error checking wildcard for ${domain}:`, error)
      return false // Assume no wildcard if check fails
    }
  }

  return { checkDomains, results, progress, isChecking, groupedResults }
}