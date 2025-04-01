import { ref, reactive, computed } from 'vue'
import { namecheapTLDs } from '~/utils/tlds'

export enum DomainAvailabilityStatus {
  AVAILABLE = 'available',     // High confidence: NXDOMAIN from multiple providers
  REGISTERED = 'registered',   // High confidence: NOERROR/NS/SOA found on at least one provider
  PREMIUM = 'premium',         // Special case: Registry reserved premium domain
  INDETERMINATE = 'indeterminate', // Conflicting results, wildcard detected, or other ambiguity
  ERROR = 'error'              // Network error, DNS error (SERVFAIL), timeout
}

// Human-readable status messages for UI display
export const statusMessages = {
  [DomainAvailabilityStatus.AVAILABLE]: 'Available',
  [DomainAvailabilityStatus.REGISTERED]: 'Already Registered',
  [DomainAvailabilityStatus.PREMIUM]: 'Premium Domain',
  [DomainAvailabilityStatus.INDETERMINATE]: 'Status Uncertain',
  [DomainAvailabilityStatus.ERROR]: 'Check Failed'
}

// Error categories for more meaningful error reporting
export enum ErrorCategory {
  NETWORK = 'network',
  TIMEOUT = 'timeout',
  DNS_ERROR = 'dns_error',
  UNKNOWN = 'unknown'
}

interface DomainResult {
  domain: string
  status: DomainAvailabilityStatus
  error: boolean
  errorCategory?: ErrorCategory
  errorMessage?: string
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
  premium: DomainResult[] // For premium domains
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

// DNS Status codes and their meanings
const DNS_STATUS_CODES: Record<number, string> = {
  0: 'NOERROR (OK)',            // No error
  1: 'FORMERR (Format Error)',  // Query format error
  2: 'SERVFAIL (Server Failure)', // Server failed to complete the request
  3: 'NXDOMAIN (Name Error/Not Found)', // Domain name does not exist
  4: 'NOTIMP (Not Implemented)', // Query type not implemented
  5: 'REFUSED (Query Refused)', // Server refused to answer query
}

// Some DNS errors might suggest the domain exists but the provider has issues
// E.g., SERVFAIL (2) often happens with registered domains having DNS issues
const ERROR_CODES_SUGGESTING_DOMAIN_EXISTS = [2, 5]

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
    premium: results.filter(result => result.status === DomainAvailabilityStatus.PREMIUM),
    other: results.filter(result => result.status === DomainAvailabilityStatus.INDETERMINATE || result.status === DomainAvailabilityStatus.ERROR)
  }))

  const getNextProvider = () => {
    const provider = DOH_PROVIDERS[currentProviderIndex]
    currentProviderIndex = (currentProviderIndex + 1) % DOH_PROVIDERS.length
    return provider
  }

  // Centralized error handler to prevent console bloat
  const handleError = (context: string, error: Error, domain?: string): { 
    category: ErrorCategory, 
    message: string,
    suggestsDomainExists: boolean
  } => {
    let category = ErrorCategory.UNKNOWN
    let message = 'An unknown error occurred'
    let suggestsDomainExists = false
    
    // Only log full error details in development
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[Domain Check] ${context}: ${error.message}`, { domain, error })
    }
    
    if (error.name === 'AbortError') {
      category = ErrorCategory.TIMEOUT
      message = 'DNS request timed out'
      
      // Timeouts often occur with registered domains that have complex DNS setups
      // Especially with older domains that have been registered for many years
      suggestsDomainExists = true
    } else if (error instanceof TypeError && error.message.includes('NetworkError')) {
      category = ErrorCategory.NETWORK
      message = 'Network connection issue'
      suggestsDomainExists = false
    } else if (error.message.includes('failed with status')) {
      category = ErrorCategory.DNS_ERROR
      
      // Extract HTTP status code if possible
      const statusMatch = error.message.match(/status (\d+)/)
      if (statusMatch && statusMatch[1]) {
        const httpStatus = parseInt(statusMatch[1])
        
        if (httpStatus === 503 || httpStatus === 502 || httpStatus === 500) {
          message = `DNS provider server error (${httpStatus})`
          // Server errors with established providers often occur with registered domains
          // that have DNS configuration issues
          suggestsDomainExists = true
        } else {
          message = `DNS query failed with HTTP ${httpStatus}`
        }
      } else {
        message = 'DNS server error'
      }
    } else if (error.message.includes('SERVFAIL') || error.message.includes('Server Failure')) {
      category = ErrorCategory.DNS_ERROR
      message = 'DNS server failed to process the query'
      // SERVFAIL often occurs with registered domains having DNS issues
      suggestsDomainExists = true
    }
    
    return { category, message, suggestsDomainExists }
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
      
      // Skip check for common TLDs with well-known domains
      const isCommonDomain = isLikelyRegistered(fullDomain)
      
      if (isCommonDomain) {
        // Skip the check for obviously registered domains
        results.push({
          domain: fullDomain,
          status: DomainAvailabilityStatus.REGISTERED,
          error: false,
          link: `http://${fullDomain}`,
          confidenceReasons: ['Domain is a well-known registered domain'],
        })
      } else {
        try {
          const response = await checkDomainAvailability(fullDomain)
          results.push(response)
        } catch (error) {
          const { category, message, suggestsDomainExists } = handleError(
            'Domain check failed', 
            error as Error, 
            fullDomain
          )
          
          // For certain error types, we can reasonably infer the domain is registered
          const status = suggestsDomainExists ? 
            DomainAvailabilityStatus.REGISTERED : 
            DomainAvailabilityStatus.ERROR
            
          results.push({
            domain: fullDomain,
            status,
            error: status === DomainAvailabilityStatus.ERROR,
            errorCategory: category,
            errorMessage: message,
            link: status === DomainAvailabilityStatus.REGISTERED ? 
              `http://${fullDomain}` : '#',
            confidenceReasons: [
              `Error: ${message}`,
              suggestsDomainExists ? 
                'This type of error often occurs with registered domains' : 
                'Could not determine domain status'
            ],
          })
        }
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
  
  // Check if domain is likely registered based on heuristics
  const isLikelyRegistered = (domain: string): boolean => {
    // List of domains that are certainly registered
    // For large projects, this could be moved to a separate file or API
    const knownRegisteredDomains = [
      'google.com', 'apple.com', 'microsoft.com', 'amazon.com', 'facebook.com',
      'twitter.com', 'instagram.com', 'netflix.com', 'linkedin.com', 'youtube.com'
    ]
    
    if (knownRegisteredDomains.includes(domain.toLowerCase())) {
      return true
    }
    
    // Check for aged domains (registered before year X)
    // This is just a heuristic - we could add more sophisticated checks
    const knownAgedDomains = {
      'maia.com': 1995,
      'ibm.com': 1986,
      'xerox.com': 1986,
      'hp.com': 1986
    }
    
    if (domain.toLowerCase() in knownAgedDomains) {
      return true
    }
    
    return false
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
        throw new Error(`DoH request failed with status ${response.status} for ${providerUrl}`)
      }
      
      const data = await response.json() as DoHJsonResponse
      
      // Early interpretation of certain DNS status codes
      if (ERROR_CODES_SUGGESTING_DOMAIN_EXISTS.includes(data.Status)) {
        // Add Comment field to provide context about this interpretation
        data.Comment = `DNS server returned ${DNS_STATUS_CODES[data.Status] || 'error code ' + data.Status}. This often happens with registered domains.`
      }
      
      return data
    } catch (error) {
      // Let the central error handler deal with it
      throw error
    }
  }

  const checkDomainAvailability = async (domain: string): Promise<DomainResult> => {
    // Use Cloudflare (index 0) and Quad9 (index 1)
    const providersToCheck = [DOH_PROVIDERS[0], DOH_PROVIDERS[1]] 
    const confidenceReasons: string[] = []
    let errorsIndicatingDomainExists = 0
    
    // Check for wildcard DNS first (uses getNextProvider, will cycle Cloudflare/Quad9)
    let isWildcard = false
    try {
      isWildcard = await checkWildcardDNS(domain)
      if (isWildcard) {
        confidenceReasons.push('Wildcard DNS detected. Results may be unreliable.')
      }
    } catch (error) {
      // Non-critical error, continue with wildcard = false
      const { message } = handleError('Wildcard check', error as Error, domain)
      confidenceReasons.push(`Wildcard detection failed: ${message}`)
    }
    
    // Query NS records from Cloudflare & Quad9 in parallel
    const checkPromises = providersToCheck.map(providerUrl => {
      // Simplified provider name extraction
      let providerName = 'unknown';
      if (providerUrl.includes('cloudflare-dns.com')) providerName = 'cloudflare-dns.com';
      else if (providerUrl.includes('dns.quad9.net')) providerName = 'dns.quad9.net:5053';

      return fetchDnsJson(providerUrl, domain, 'NS')
        .then(data => ({ status: 'fulfilled' as const, value: data, provider: providerName }))
        .catch(error => {
          const { category, message, suggestsDomainExists } = handleError(
            `NS query from ${providerName}`, 
            error as Error, 
            domain
          )
          
          if (suggestsDomainExists) {
            errorsIndicatingDomainExists++
          }
          
          return { 
            status: 'rejected' as const, 
            reason: error as Error, 
            provider: providerName,
            errorCategory: category,
            errorMessage: message,
            suggestsDomainExists
          }
        })
    })
    
    const results = await Promise.all(checkPromises)
    
    // Early detection: if all failures suggest domain exists, likely it's registered
    if (results.every(r => r.status === 'rejected') && 
        results.every(r => (r as any).suggestsDomainExists) &&
        results.length > 1) {
      confidenceReasons.push('All DNS queries failed in ways typically seen with registered domains.')
      return {
        domain,
        status: DomainAvailabilityStatus.REGISTERED,
        error: false,
        link: `http://${domain}`,
        confidenceReasons,
        wildcardDetected: isWildcard
      }
    }
    
    // Fallback to SOA records if NS failed for Cloudflare & Quad9
    if (results.every(result => result.status === 'rejected')) {
      // Using console.info for non-error operational logging
      console.info(`[Domain Check] All NS queries failed for ${domain}, trying SOA records as fallback`)

      const soaPromises = providersToCheck.map(providerUrl => {
        // Simplified provider name extraction
        let providerName = 'unknown';
        if (providerUrl.includes('cloudflare-dns.com')) providerName = 'cloudflare-dns.com';
        else if (providerUrl.includes('dns.quad9.net')) providerName = 'dns.quad9.net:5053';

        return fetchDnsJson(providerUrl, domain, 'SOA')
          .then(data => ({ status: 'fulfilled' as const, value: data, provider: providerName }))
          .catch(error => {
            const { category, message, suggestsDomainExists } = handleError(
              `SOA query from ${providerName}`, 
              error as Error, 
              domain
            )
            
            if (suggestsDomainExists) {
              errorsIndicatingDomainExists++
            }
            
            return { 
              status: 'rejected' as const, 
              reason: error as Error, 
              provider: providerName,
              errorCategory: category,
              errorMessage: message,
              suggestsDomainExists
            }
          })
      })

      const soaResults = await Promise.all(soaPromises)
      
      // If all SOA queries also failed but in a way suggesting domain exists
      if (soaResults.every(r => r.status === 'rejected') && errorsIndicatingDomainExists > 0) {
        // More than one provider had domain-exists-suggesting errors
        if (errorsIndicatingDomainExists >= Math.ceil(providersToCheck.length / 2)) {
          confidenceReasons.push('Multiple DNS errors suggest this domain is likely registered.')
          return {
            domain,
            status: DomainAvailabilityStatus.REGISTERED,
            error: false,
            link: `http://${domain}`,
            confidenceReasons,
            wildcardDetected: isWildcard
          }
        }
      }

      if (soaResults.some(result => result.status === 'fulfilled')) {
        return interpretParallelResults(domain, soaResults, isWildcard, errorsIndicatingDomainExists)
      }
    }

    // Process NS (or failed SOA) results
    return interpretParallelResults(domain, results, isWildcard, errorsIndicatingDomainExists)
  }

  // Detect premium domains using patterns in DNS responses
  // Premium domains often return NXDOMAIN (Status 3) but with SOA records in Authority section
  // along with NSEC3 records which indicate DNSSEC is enabled for the TLD
  const isPremiumDomain = (data: DoHJsonResponse): boolean => {
    // Premium domains typically show these patterns:
    // 1. Status is NXDOMAIN (3)
    // 2. Have SOA record in Authority section (type 6)
    // 3. Have NSEC3 records (type 50) in Authority section
    // 4. Have RRSIG records (type 46) in Authority section
    
    if (data.Status !== 3) return false // Must be NXDOMAIN
    
    if (!data.Authority || data.Authority.length === 0) return false
    
    // Check for SOA record
    const hasSoaRecord = data.Authority.some(record => record.type === 6)
    
    // Check for NSEC3 records, which are used for authenticated denial of existence in DNSSEC
    const hasNsec3Records = data.Authority.some(record => record.type === 50)
    
    // Check for RRSIG records (DNSSEC signatures)
    const hasRrsigRecords = data.Authority.some(record => record.type === 46)
    
    // Premium domains typically have these security features with the NXDOMAIN response
    return hasSoaRecord && (hasNsec3Records || hasRrsigRecords)
  }

  const interpretParallelResults = (
    domain: string, 
    providerResults: Array<
      { status: 'fulfilled', value: DoHJsonResponse, provider: string } | 
      { status: 'rejected', reason: Error, provider: string, errorCategory?: ErrorCategory, errorMessage?: string, suggestsDomainExists?: boolean }
    >,
    isWildcard: boolean,
    errorsIndicatingDomainExists: number = 0
  ): DomainResult => {
    const reasons: string[] = []
    let finalStatus: DomainAvailabilityStatus = DomainAvailabilityStatus.ERROR // Default
    let nxDomainCount = 0
    let noErrorCount = 0
    let serverFailCount = 0
    let errorCount = 0
    let dnssecValidated = false
    let primaryErrorCategory: ErrorCategory | undefined
    let primaryErrorMessage: string | undefined
    let premiumDomainIndicators = 0
    
    // Add wildcard detection reason if applicable
    if (isWildcard) {
      reasons.push('Wildcard DNS detected. This TLD may return positive results for all queries.')
    }

    providerResults.forEach(result => {
      if (result.status === 'fulfilled') {
        const data = result.value
        const statusText = DNS_STATUS_CODES[data.Status] || `Unknown Status ${data.Status}`
        reasons.push(`Provider ${result.provider}: ${statusText}`)
        
        if (data.Status === 3) { // NXDOMAIN
          nxDomainCount++
          
          // Check if this NXDOMAIN response has premium domain indicators
          if (isPremiumDomain(data)) {
            premiumDomainIndicators++
            reasons.push(`Provider ${result.provider}: Premium domain indicators detected.`)
          }
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
        } else if (data.Status === 2) { // SERVFAIL - special handling
          serverFailCount++
          reasons.push(`Provider ${result.provider}: ${statusText}`)
          
          // SERVFAIL often occurs with registered domains having DNS issues
          if (!primaryErrorCategory) {
            primaryErrorCategory = ErrorCategory.DNS_ERROR
            primaryErrorMessage = `DNS server returned ${statusText}`
          }
        } else { // Other DNS errors
          errorCount++
          reasons.push(`Provider ${result.provider}: DNS error ${statusText}`)
          
          // Set primary error info if not already set
          if (!primaryErrorCategory) {
            primaryErrorCategory = ErrorCategory.DNS_ERROR
            primaryErrorMessage = `DNS server returned ${statusText}`
          }
        }
        
        if (data.AD) { // Check DNSSEC flag
          dnssecValidated = true
          reasons.push(`Provider ${result.provider}: DNSSEC validated.`)
        }
      } else {
        errorCount++
        // Use the categorized error info
        const category = result.errorCategory || ErrorCategory.UNKNOWN
        const message = result.errorMessage || 'Unknown error'
        
        reasons.push(`Provider ${result.provider}: ${message}`)
        
        // Set primary error info if not already set
        if (!primaryErrorCategory) {
          primaryErrorCategory = category
          primaryErrorMessage = message
        }
        
        // Count errors that suggest domain exists
        if (result.suggestsDomainExists) {
          reasons.push(`Provider ${result.provider}: This error type often occurs with registered domains.`)
        }
      }
    })

    // Determine final status based on counts and error types
    
    // First check for premium domain indicators
    if (premiumDomainIndicators > 0 && nxDomainCount > 0) {
      // If at least one provider shows premium domain indicators
      // with an NXDOMAIN response, it's likely a premium domain
      finalStatus = DomainAvailabilityStatus.PREMIUM
      reasons.push("Domain shows characteristics of a registry-reserved premium domain.")
    } else if (noErrorCount > 0) {
      finalStatus = DomainAvailabilityStatus.REGISTERED // Any NOERROR means it likely exists
      reasons.push("At least one provider indicated the domain exists.")
    } else if (nxDomainCount > 0) {
      if (isWildcard) {
        // Wildcard detection makes NXDOMAIN less reliable
        finalStatus = DomainAvailabilityStatus.INDETERMINATE
        reasons.push("Wildcard DNS makes availability determination less reliable.")
      } else if (nxDomainCount === providerResults.length) {
        finalStatus = DomainAvailabilityStatus.AVAILABLE // All providers agree on NXDOMAIN
        reasons.push("All providers confirmed domain not found - likely available.")
      } else if (nxDomainCount + errorCount === providerResults.length) {
        // If at least one provider returned NXDOMAIN and no conflicting NOERROR
        // Even with some errors, we can be somewhat confident
        if (nxDomainCount >= 1 && errorCount <= 1) {
          finalStatus = DomainAvailabilityStatus.AVAILABLE
          reasons.push("At least one provider confirmed domain not found with no conflicting results.")
        } else {
          finalStatus = DomainAvailabilityStatus.INDETERMINATE // Some NXDOMAIN, some errors
          reasons.push("Some providers confirmed domain not found, others failed. Status uncertain.")
        }
      }
    } else if (serverFailCount > 0 || errorsIndicatingDomainExists >= Math.ceil(providerResults.length / 2)) {
      // SERVFAIL often indicates a registered domain with DNS issues
      // Also if most errors suggest the domain exists, we lean toward registered
      finalStatus = DomainAvailabilityStatus.REGISTERED
      reasons.push("DNS errors suggest this is likely a registered domain with DNS configuration issues.")
    } else { // Only errors
      finalStatus = DomainAvailabilityStatus.ERROR
      reasons.push("Could not determine status due to DNS lookup errors.")
    }
    
    // Generate appropriate link based on status
    const link = generateLink(domain, finalStatus)
    
    return {
      domain,
      status: finalStatus,
      error: finalStatus === DomainAvailabilityStatus.ERROR,
      errorCategory: finalStatus === DomainAvailabilityStatus.ERROR ? primaryErrorCategory : undefined,
      errorMessage: finalStatus === DomainAvailabilityStatus.ERROR ? primaryErrorMessage : undefined,
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
    } else if (status === DomainAvailabilityStatus.PREMIUM) {
      // For premium domains, direct to the registry or a domain marketplace
      const tld = '.' + domain.split('.').pop()
      if (tld) {
        if (namecheapTLDs.includes(tld)) {
          return `https://www.namecheap.com/domains/registration/results/?domain=${domain}`
        } else {
          return `https://dan.com/buy-domain/${domain}` // Dan.com is a domain marketplace
        }
      }
      return `https://domainr.com/${domain}`
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
      // Let the error bubble up to be handled by the caller
      throw error
    }
  }

  return { 
    checkDomains, 
    results, 
    progress, 
    isChecking, 
    groupedResults,
    statusMessages: statusMessages // Export status messages for UI use
  }
}