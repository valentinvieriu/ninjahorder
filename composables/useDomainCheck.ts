import { ref, reactive, computed } from 'vue'
import { namecheapTLDs } from '~/utils/tlds'

interface DomainResult {
  domain: string
  available: boolean
  error: boolean
  link: string
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

export const useDomainCheck = () => {
  const results = reactive<DomainResult[]>([])
  const progress = ref(0)
  const isChecking = ref(false)
  const cache = ref<Record<string, CacheEntry>>({})

  const groupedResults = computed<GroupedResults>(() => {
    return {
      available: results.filter(result => result.available),
      notAvailable: results.filter(result => !result.available)
    }
  })

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
    const url = `https://cloudflare-dns.com/dns-query?name=${domain}&type=A`

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/dns-json',
        },
      })
      const data = (await response.json()) as DoHResponse

      const isRegistered =
        (data.Status === 0 && (data.Answer?.length ?? 0) > 0) ||
        (data.Status === 3 && data.Authority?.some(auth => auth.type !== 6))

      const available = !isRegistered

      let link = '#'
      if (available) {
        const tld = '.' + domain.split('.').pop()
        if (tld && namecheapTLDs.includes(tld)) {
          link = `https://www.namecheap.com/domains/registration/results/?domain=${domain}`
        } else {
          link = `https://domainr.com/${domain}`
        }
      } else {
        link = `http://${domain}`
      }

      return { domain, available, link, error: false }
    } catch (error) {
      console.error(`Error checking ${domain}:`, error)
      return { domain, available: false, link: '#', error: true }
    }
  }

  return {
    checkDomains,
    results: groupedResults,
    progress,
    isChecking,
  }
}
