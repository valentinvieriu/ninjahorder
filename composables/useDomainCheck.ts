import { ref, reactive, computed } from 'vue'
import { namecheapTLDs } from '~/utils/tlds'

interface DomainResult {
  domain: string
  available: boolean
  error: boolean
  link: string
  confidence: number
  confidenceReasons: string[]
}

// Define the DoHResponse interface to match the DNS over HTTPS response schema
interface DoHResponse {
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
}

const DOH_PROVIDERS = [
  'https://cloudflare-dns.com/dns-query',
  'https://dns.google/dns-query',
  'https://dns.quad9.net:5053/dns-query',
]

const TIMEOUT_MS = 5000 // 5 seconds timeout

export const useDomainCheck = () => {
  const results = reactive<DomainResult[]>([])
  const progress = ref(0)
  const isChecking = ref(false)
  const cache = ref<Record<string, CacheEntry>>({})
  let currentProviderIndex = 0

  const groupedResults = computed<GroupedResults>(() => ({
    available: results.filter(result => result.available),
    notAvailable: results.filter(result => !result.available)
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
          available: false,
          error: true,
          link: '#',
          confidence: 0,
          confidenceReasons: [],
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

  const checkDomainAvailability = async (domain: string): Promise<DomainResult> => {
    let confidence = 100
    const confidenceReasons: string[] = []
    let isRegistered = false
    let hasError = false

    try {
      const provider = getNextProvider()
      const dnsQuery = createDNSQuery(domain, 'A', true) // Query for 'A' record with DNSSEC
      const encodedDNSQuery = btoa(String.fromCharCode.apply(null, new Uint8Array(dnsQuery)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      const url = `${provider}?dns=${encodedDNSQuery}`

      const response = await fetchWithTimeout(url, {
        method: 'GET',
        headers: { 'Accept': 'application/dns-message' }
      }, TIMEOUT_MS)
      
      const data = await response.arrayBuffer()
      const dnsResponse = parseDNSResponse(new Uint8Array(data))

      if (dnsResponse.rcode === 0 && dnsResponse.answers.length > 0) {
        isRegistered = true
        confidence -= 30
        confidenceReasons.push('Domain has an A record, likely registered.')
      } else if (dnsResponse.rcode === 3) {
        confidence += 10
        confidenceReasons.push('Domain not found (NXDOMAIN).')
      } else {
        hasError = true
        confidence -= 20
        confidenceReasons.push(`Unexpected DNS response (rcode ${dnsResponse.rcode}).`)
      }

      // DNSSEC validation
      if (dnsResponse.ad) {
        confidence += 10
        confidenceReasons.push('DNSSEC validated response.')
      }

      // Wildcard check
      const isWildcard = await checkWildcardDNS(domain)
      if (isWildcard) {
        confidence -= 15
        confidenceReasons.push('Wildcard DNS detected.')
      }

    } catch (error) {
      console.error(`Error checking ${domain}:`, error)
      hasError = true
      confidence -= 20
      confidenceReasons.push('Error in checking DNS.')
    }

    // Ensure confidence is within 0-100
    confidence = Math.max(0, Math.min(100, confidence))

    // Determine the link
    let link = isRegistered ? `http://${domain}` : `https://domainr.com/${domain}`
    if (!isRegistered) {
      const tld = '.' + domain.split('.').pop()
      if (tld && namecheapTLDs.includes(tld)) {
        link = `https://www.namecheap.com/domains/registration/results/?domain=${domain}`
      }
    }

    return {
      domain,
      available: !isRegistered,
      error: hasError,
      link,
      confidence,
      confidenceReasons,
    }
  }

  const checkWildcardDNS = async (domain: string): Promise<boolean> => {
    const randomSubdomain = Math.random().toString(36).substring(2, 15)
    const wildcardDomain = `${randomSubdomain}.${domain}`

    try {
      const provider = getNextProvider()
      const dnsQuery = createDNSQuery(wildcardDomain, 'A')
      const encodedDNSQuery = btoa(String.fromCharCode.apply(null, new Uint8Array(dnsQuery)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      const url = `${provider}?dns=${encodedDNSQuery}`
      const response = await fetchWithTimeout(url, {
        method: 'GET',
        headers: { Accept: 'application/dns-message' },
      }, TIMEOUT_MS)
      
      const data = await response.arrayBuffer()
      const dnsResponse = parseDNSResponse(new Uint8Array(data))

      return dnsResponse.rcode === 0 && dnsResponse.answers.length > 0
    } catch (error) {
      console.error(`Error checking wildcard for ${domain}:`, error)
      return false
    }
  }

  // Helper function to create a DNS query in wire format
  function createDNSQuery(domain: string, type: string, dnssec: boolean = false): Uint8Array {
    const typeNum = {'A': 1, 'NS': 2, 'SOA': 6, 'MX': 15}[type] || 1
    const flags = dnssec ? 0x0100 : 0x0000 // Set DO bit for DNSSEC
    const header = new Uint8Array([0, 0, flags >> 8, flags & 0xFF, 0, 1, 0, 0, 0, 0, 0, 0])
    const question = new TextEncoder().encode(domain.split('.').map(part => String.fromCharCode(part.length) + part).join('') + '\0')
    const qtype = new Uint8Array([0, typeNum])
    const qclass = new Uint8Array([0, 1])  // IN class
    return new Uint8Array([...header, ...question, ...qtype, ...qclass])
  }

  // Helper function to parse DNS response
  function parseDNSResponse(response: Uint8Array): { rcode: number, answers: any[], ad: boolean } {
    const flags = (response[2] << 8) | response[3]
    const rcode = flags & 0x0F
    const ad = (flags & 0x0020) !== 0
    const ancount = (response[6] << 8) | response[7]
    return { rcode, answers: new Array(ancount), ad }
  }

  return {
    checkDomains,
    results: groupedResults,
    progress,
    isChecking,
  }
}