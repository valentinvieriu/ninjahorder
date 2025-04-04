import { ref, reactive, computed } from 'vue'
import { namecheapTLDs } from '~/utils/tlds'
import { DohResolver, DnsStatusCode, DnsRecordType } from '~/utils/DohResolver'
import type { DnsResponse } from '~/utils/DohResolver'

// --- Constants ---
const DNS_STATUS_NOERROR = 0
const DNS_STATUS_FORMERR = 1
const DNS_STATUS_SERVFAIL = 2
const DNS_STATUS_NXDOMAIN = 3
const DNS_STATUS_NOTIMP = 4
const DNS_STATUS_REFUSED = 5

const DNS_RECORD_TYPE_A = 1
const DNS_RECORD_TYPE_NS = 2
const DNS_RECORD_TYPE_SOA = 6
const DNS_RECORD_TYPE_TXT = 16
const DNS_RECORD_TYPE_RRSIG = 46
const DNS_RECORD_TYPE_NSEC3 = 50

// Error codes suggesting domain might exist despite failure
const ERROR_CODES_SUGGESTING_DOMAIN_EXISTS = [
  DNS_STATUS_SERVFAIL, // Server Failure
  DNS_STATUS_REFUSED,  // Query Refused
];

const TIMEOUT_MS = 5000 // 5 seconds timeout
const MAX_RETRIES = 1 // Maximum number of retries for transient network/timeout errors

// Known TLDs that frequently use wildcards
const KNOWN_WILDCARD_TLDS = new Set([
  '.tk', '.ml', '.ga', '.cf', '.gq', // Freenom TLDs
  '.to', '.cc', '.ws', '.pw', // Several others known to use wildcards
]);

// --- Parking Detection Data ---
// Source: https://raw.githubusercontent.com/MISP/misp-warninglists/main/lists/parking-domain-ns/list.json
const PARKING_NAMESERVERS = new Set([
  'above.com',
  'afternic.com',
  'alter.com',
  'bodis.com',
  'bookmyname.com',
  'brainydns.com',
  'brandbucket.com',
  'chookdns.com',
  'cnomy.com',
  'commonmx.com',
  'dan.com',
  'day.biz',
  'dingodns.com',
  'directnic.com',
  'dne.com',
  'dnslink.com',
  'dnsnuts.com',
  'dnsowl.com',
  'dnsspark.com',
  'domain-for-sale.at',
  'domain-for-sale.se',
  'domaincntrol.com',
  'domainhasexpired.com',
  'domainist.com',
  'domainmarket.com',
  'domainmx.com',
  'domainorderdns.nl',
  'domainparking.ru',
  'domainprofi.de',
  'domainrecover.com',
  'dsredirection.com',
  'dsredirects.com',
  'eftydns.com',
  'emailverification.info',
  'emu-dns.com',
  'expiereddnsmanager.com',
  'expirationwarning.net',
  'expired.uniregistry-dns.com',
  'fabulous.com',
  'failed-whois-verification.namecheap.com.',
  'fastpark.net',
  'freenom.com',
  'gname.net',
  'hastydns.com',
  'hostresolver.com',
  'ibspark.com',
  'kirklanddc.com',
  'koaladns.com',
  'magpiedns.com',
  'malkm.com',
  'markmonitor.com',
  'mijndomein.nl',
  'milesmx.com',
  'mytrafficmanagement.com',
  'name.com',
  'namedynamics.net',
  'nameprovider.net',
  'ndsplitter.com',
  'ns01.cashparking.com',
  'ns02.cashparking.com',
  'ns1.domain-is-4-sale-at-domainmarket.com',
  'ns1.domain.io',
  'ns1.namefind.com',
  'ns1.park.do',
  'ns1.parkingcrew.net',
  'ns1.pql.net',
  'ns1.sedoparking.com',
  'ns1.smartname.com',
  'ns1.sonexo.eu',
  'ns1.undeveloped.com',
  'ns2.domain.io',
  'ns2.domainmarket.com',
  'ns2.namefind.com',
  'ns2.park.do',
  'ns2.parkingcrew.net',
  'ns2.pql.net',
  'ns2.sedoparking.com',
  'ns2.smartname.com',
  'ns2.sonexo.com',
  'ns2.undeveloped.com',
  'ns3.tppns.com',
  'ns4.tppns.com',
  'nsresolution.com',
  'one.com',
  'onlydomains.com',
  'panamans.com',
  'park1.encirca.net',
  'park2.encirca.net',
  'parkdns1.internetvikings.com',
  'parkdns2.internetvikings.com',
  'parking-page.net',
  'parking.namecheap.com',
  'parking1.ovh.net',
  'parking2.ovh.net',
  'parkingcrew.net',
  'parkingpage.namecheap.com',
  'parkingspa.com',
  'parklogic.com',
  'parktons.com',
  'perfectdomain.com',
  'quokkadns.com',
  'redirectdom.com',
  'redmonddc.com',
  'registrar-servers.com',
  'renewyourname.net',
  'rentondc.com',
  'rookdns.com',
  'rzone.de',
  'sav.com',
  'searchfusion.com',
  'searchreinvented.com',
  'securetrafficrouting.com',
  'sedo.com',
  'sedoparking.com',
  'smtmdns.com',
  'snparking.ru',
  'squadhelp.com',
  'sslparking.com',
  'tacomadc.com',
  'taipandns.com',
  'thednscloud.com',
  'torresdns.com',
  'trafficcontrolrouter.com',
  'trustednam.es',
  'uniregistrymarket.link',
  'verify-contact-details.namecheap.com.',
  'voodoo.com',
  'weaponizedcow.com',
  'wombatdns.com',
  'wordpress.com',
  'www.undeveloped.com----type.in',
  'your-browser.this-domain.eu',
  'ztomy.com',
  'dns1.registrar-servers.com',
  'dns2.registrar-servers.com'
].map(ns => ns.toLowerCase())); // Store in lowercase for case-insensitive comparison

// Comprehensive pattern definitions based on research (Memoized at module level)
const PARKING_PATTERNS = {
    // Restrictive SPF policies
    SPF: [
        /^v=spf1\s+-all$/i,                   // Explicit block all
        /^v=spf1\s+(?!.*[?~+]).*-all$/i       // Any non-permissive SPF ending with -all
    ],
    // Empty/null DKIM configurations
    DKIM: [
        /v=DKIM1;\s*p=\s*$/i,                 // Empty p parameter
        /v=DKIM1;\s*p=["']?\s*["']?$/i,       // Empty quoted p parameter
        /v=DKIM1;\s*k=rsa;\s*p=$/i            // RSA key with empty p
    ],
    // Restrictive DMARC policies
    DMARC: [
        /v=DMARC1;\s*p=reject/i,              // Reject policy
        /v=DMARC1;\s*p=quarantine/i,          // Quarantine policy
        /v=DMARC1;\s*p=reject;\s*adkim=s/i    // Strict alignment
    ],
    // Explicit registrar parking indicators
    REGISTRAR: [
        /parking_verification/i,               // Standard parking verification
        /domain_control_validation/i,          // Domain control validation
        /sedoparking/i,                        // Sedo parking
        /parkingcrew/i,                        // ParkingCrew
        /domain[-_]?parking/i                  // Generic domain parking
    ],
    // Premium domain markers
    PREMIUM: [
        /premium[-_]?domain/i,                 // Premium domain indicator
        /domain[-_]?for[-_]?sale/i,            // For sale marker
        /inquire.*purchase/i,                  // Purchase inquiry
        /domainbroker/i,                       // Domain broker reference
        /reserve[d]?[-_]?domain/i              // Reserved domain
    ],
    // Active domain usage signals
    ACTIVE_USAGE: [
        /google-site-verification=/i,          // Google site verification
        /ms=ms\d+/i,                           // Microsoft verification
        /facebook-domain-verification=/i,      // Facebook domain verification
        /apple-domain-verification=/i,         // Apple domain verification
        /docusign=.+/i,                        // DocuSign verification
        /stripe-verification=/i                // Stripe verification
    ]
};

// --- Enums and Types (Existing) ---
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

// Define check steps for more detailed progress reporting
export enum CheckStage {
  PREPARING = 'preparing',
  WILDCARD_CHECK = 'wildcard_check',
  PRIMARY_QUERY = 'primary_query',
  FALLBACK_QUERY = 'fallback_query',
  ANALYZING = 'analyzing',
  FINALIZING = 'finalizing',
  COMPLETE = 'complete'
}

// Human-readable status messages for progress stages
export const stageMessages = {
  [CheckStage.PREPARING]: 'Preparing domain check...',
  [CheckStage.WILDCARD_CHECK]: 'Checking for wildcard DNS...',
  [CheckStage.PRIMARY_QUERY]: 'Querying primary DNS providers...',
  [CheckStage.FALLBACK_QUERY]: 'Performing additional DNS checks...',
  [CheckStage.ANALYZING]: 'Analyzing DNS responses...',
  [CheckStage.FINALIZING]: 'Finalizing results...',
  [CheckStage.COMPLETE]: 'Check complete'
}

// Error categories for more meaningful error reporting
export enum ErrorCategory {
  NETWORK = 'network',
  TIMEOUT = 'timeout',
  DNS_ERROR = 'dns_error',
  UNKNOWN = 'unknown'
}

// Extended progress interface
export interface ProgressState {
  percentage: number,
  currentDomain?: string,
  stage: CheckStage,
  domainsProcessed: number,
  totalDomains: number,
  detailedMessage?: string
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
  isParkedByNs: boolean
  isParkedByTxt: boolean
}

// Update DoHJsonResponse to extend the DnsResponse interface
interface DoHJsonResponse extends DnsResponse {
  // Keep any additional properties specific to this implementation
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

// --- Provider Configuration ---
// Define provider configurations in a structured way
interface ProviderConfig {
  name: string;
  baseUrl: string;
  formatUrl: (baseUrl: string, domain: string, type: number) => string;
  headers: Record<string, string>;
}

const PROVIDERS: Record<string, ProviderConfig> = {
  'cloudflare': {
    name: 'Cloudflare',
    baseUrl: 'https://cloudflare-dns.com/dns-query',
    formatUrl: (baseUrl, domain, type) =>
      `${baseUrl}?name=${encodeURIComponent(domain)}&type=${type}`,
    headers: { 'Accept': 'application/dns-json' }
  },
  'quad9': {
    name: 'Quad9',
    baseUrl: 'https://dns.quad9.net:5053/dns-query',
    formatUrl: (baseUrl, domain, type) =>
      `${baseUrl}?name=${encodeURIComponent(domain)}&type=${type}`,
    headers: { 'Accept': 'application/dns-json' }
  },
  'google': {
    name: 'Google',
    baseUrl: 'https://dns.google/resolve',
    formatUrl: (baseUrl, domain, type) =>
      `${baseUrl}?name=${encodeURIComponent(domain)}&type=${type}`,
    headers: { 'Accept': 'application/dns-json' }
  }
};

const DOH_PROVIDER_URLS = Object.values(PROVIDERS).map(p => p.baseUrl);

// Define primary providers for consensus checking (first 2 providers)
// These are the providers we trust most for determining domain status
const PRIMARY_PROVIDER_URLS = [
  PROVIDERS.cloudflare.baseUrl,
  PROVIDERS.google.baseUrl
];

// Helper to get config based on URL (more robust than string includes)
const getProviderConfigFromUrl = (url: string): ProviderConfig | undefined => {
  return Object.values(PROVIDERS).find(p => url.startsWith(p.baseUrl));
};

// DNS Status codes and their meanings (Used in logging/reasoning)
const DNS_STATUS_MESSAGES: Record<number, string> = {
  [DNS_STATUS_NOERROR]: 'NOERROR (OK)',
  [DNS_STATUS_FORMERR]: 'FORMERR (Format Error)',
  [DNS_STATUS_SERVFAIL]: 'SERVFAIL (Server Failure)',
  [DNS_STATUS_NXDOMAIN]: 'NXDOMAIN (Name Error/Not Found)',
  [DNS_STATUS_NOTIMP]: 'NOTIMP (Not Implemented)',
  [DNS_STATUS_REFUSED]: 'REFUSED (Query Refused)',
};

// --- Hardcoded Heuristic Lists for isLikelyRegistered ---
// Note: These are simple heuristics, not exhaustive.
// REMOVED: const KNOWN_REGISTERED_DOMAINS = new Set([...]);
// REMOVED: const KNOWN_AGED_DOMAINS = new Set([...]);

export const useDomainCheck = (options: { useWorkers?: boolean } = {}) => {
  const results = reactive<DomainResult[]>([])
  const progress = ref<ProgressState>({
    percentage: 0,
    stage: CheckStage.PREPARING,
    domainsProcessed: 0,
    totalDomains: 0
  })
  const isChecking = ref(false)
  const cache = ref<Record<string, CacheEntry>>({})
  let currentProviderIndex = 0
  let worker: Worker | null = null

  const { useWorkers = false } = options

  const groupedResults = computed<GroupedResults>(() => ({
    available: results.filter(result => result.status === DomainAvailabilityStatus.AVAILABLE),
    notAvailable: results.filter(result => result.status === DomainAvailabilityStatus.REGISTERED),
    premium: results.filter(result => result.status === DomainAvailabilityStatus.PREMIUM),
    other: results.filter(result => result.status === DomainAvailabilityStatus.INDETERMINATE || result.status === DomainAvailabilityStatus.ERROR)
  }))

  const getNextProviderUrl = () => {
    const providerUrl = DOH_PROVIDER_URLS[currentProviderIndex]
    currentProviderIndex = (currentProviderIndex + 1) % DOH_PROVIDER_URLS.length
    return providerUrl
  }

  // Cleanup worker on component unmount or before creating a new one
  const cleanupWorker = () => {
    if (worker) {
      worker.terminate()
      worker = null
    }
  }

  // Main entry point that decides between standard and worker implementation
  const checkDomains = async (domainName: string, selectedTLDs: string[]) => {
    if (useWorkers && typeof Worker !== 'undefined') {
      return checkDomainsWithWorker(domainName, selectedTLDs)
    } else {
      return checkDomainsStandard(domainName, selectedTLDs)
    }
  }

  // Centralized error handler
  const handleError = (context: string, error: Error, domain?: string): {
    category: ErrorCategory,
    message: string,
    suggestsDomainExists: boolean
  } => {
    let category = ErrorCategory.UNKNOWN
    let message = 'An unknown error occurred'
    let suggestsDomainExists = false
    
    // Basic Error Classification
    if (error.name === 'AbortError' || error.message.toLowerCase().includes('timeout')) {
      category = ErrorCategory.TIMEOUT
      message = 'DNS request timed out'
      // Timeouts can happen for various reasons, might weakly suggest a complex/slow setup (registered)
      suggestsDomainExists = true
    } else if (error instanceof TypeError && (error.message.includes('NetworkError') || error.message.includes('fetch'))) {
      // Network errors usually mean connectivity issues, not related to domain status
      category = ErrorCategory.NETWORK
      message = 'Network connection issue'
      suggestsDomainExists = false
    } else if (error.message.includes('status')) { // Likely an HTTP error from fetch
      category = ErrorCategory.DNS_ERROR
      const statusMatch = error.message.match(/status (\d+)/)
      const httpStatus = statusMatch ? parseInt(statusMatch[1], 10) : null

      if (httpStatus && [500, 502, 503, 504].includes(httpStatus)) {
        message = `DoH provider server error (${httpStatus})`
        // Server errors *might* correlate slightly with complex/problematic DNS for registered domains
        suggestsDomainExists = true
      } else if (httpStatus) {
        message = `DoH query failed with HTTP ${httpStatus}`
         // Other client/server HTTP errors don't strongly suggest registered/unregistered
        suggestsDomainExists = false
      } else {
        message = 'DoH server error (Unknown Status)'
         suggestsDomainExists = false
      }
    } else if (error.message.includes('SERVFAIL') || error.message.includes('Server Failure')) {
       // Specific handling if SERVFAIL is caught before JSON parsing
      category = ErrorCategory.DNS_ERROR
      message = 'DNS server failed to process the query (SERVFAIL)'
      suggestsDomainExists = true // SERVFAIL often happens with registered domains
    } else {
       // Default to unknown DNS error if not classified above
       category = ErrorCategory.DNS_ERROR
       message = `DNS lookup error: ${error.message}`
       // Default to not assuming existence for generic errors
       suggestsDomainExists = false
    }

     // Log details only in development
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[Domain Check Error] Context: ${context}, Domain: ${domain || 'N/A'}, Category: ${category}, Message: ${message}, OriginalError:`, error)
    }

    return { category, message, suggestsDomainExists }
  }

  const fetchDnsJson = async (providerUrl: string, domain: string, recordType: number): Promise<DoHJsonResponse> => {
    const config = getProviderConfigFromUrl(providerUrl);
    if (!config) {
      // Should not happen if providerUrl comes from DOH_PROVIDER_URLS
      throw new Error(`Configuration error: Unknown DNS provider URL: ${providerUrl}`);
    }
    
    let attempts = 0;
    let lastError: Error | null = null;

    while (attempts <= MAX_RETRIES) {
      try {
        // Create a DohResolver instance
        const resolver = new DohResolver(config.baseUrl);
        
        // Convert numeric record type to string if needed for readability in logs
        let recordTypeStr: string;
        switch (recordType) {
          case DNS_RECORD_TYPE_NS:
            recordTypeStr = 'NS';
            break;
          case DNS_RECORD_TYPE_SOA:
            recordTypeStr = 'SOA';
            break;
          case DNS_RECORD_TYPE_TXT:
            recordTypeStr = 'TXT';
            break;
          default:
            recordTypeStr = recordType.toString();
        }
        
        // Use the DohResolver to query the domain
        const data = await resolver.query(
          domain, 
          recordType, 
          'GET',  // Use GET method which is more compatible with DoH providers
          config.headers, 
          TIMEOUT_MS
        ) as DoHJsonResponse;

        // Add context if the DNS status code itself suggests existence
        if (ERROR_CODES_SUGGESTING_DOMAIN_EXISTS.includes(data.Status)) {
          data.Comment = `DNS server returned ${DNS_STATUS_MESSAGES[data.Status] || 'error code ' + data.Status}. This often happens with registered domains.`
        }
        
        return data;
      } catch (rawError) {
        const error = rawError instanceof Error ? rawError : new Error(String(rawError));
        lastError = error;
        attempts++;
        
        // Determine if this is a retryable error (timeout or specific network issues)
        const isTimeout = error instanceof DOMException && error.name === 'AbortError' || 
                          error.message.toLowerCase().includes('timeout');
        
        // Check if it's a server error that might be transient
        const isTransientServerError = error.message.includes('status') && 
                                       /status (50[234])/.test(error.message);
        
        if ((isTimeout || isTransientServerError) && attempts <= MAX_RETRIES) {
          // This is a retryable error and we haven't exceeded MAX_RETRIES
          console.warn(`[Domain Check] Retrying query for ${domain} (${recordType}) with ${config.name} (Attempt ${attempts}/${MAX_RETRIES}) after error: ${error.message}`);
          // Add a small delay before retry
          await new Promise(resolve => setTimeout(resolve, 200));
          continue;
        }
        
        // Either not retryable or exceeded max retries
        break;
      }
    }

    // If we get here, all attempts failed
    if (lastError) {
      throw lastError;
    } else {
      throw new Error('Unknown error during DNS fetch');
    }
  }

  // Worker-based implementation
  const checkDomainsWithWorker = async (domainName: string, selectedTLDs: string[]) => {
    // Sort TLDs for consistent cache key
    const sortedTLDs = [...selectedTLDs].sort()
    const cacheKey = `${domainName}:${sortedTLDs.join(',')}`
    const cachedEntry = cache.value[cacheKey]

    // Check cache
    if (cachedEntry && Date.now() - cachedEntry.timestamp < 5 * 60 * 1000) { // 5 min cache
      results.splice(0, results.length, ...cachedEntry.results)
      console.info(`[Domain Check] Cache hit for ${domainName} with TLDs: ${sortedTLDs.join(',')}`)
      return groupedResults.value
    }
    console.info(`[Domain Check] Cache miss or expired for ${domainName} with TLDs: ${sortedTLDs.join(',')}`)

    // Reset state
    results.splice(0, results.length) // Clear previous results using splice for reactivity
    progress.value = {
      percentage: 0,
      stage: CheckStage.PREPARING,
      domainsProcessed: 0,
      totalDomains: sortedTLDs.length
    }
    isChecking.value = true

    try {
      // Cleanup any existing worker
      cleanupWorker()

      // Create a new worker
      worker = new Worker(new URL('./domainCheck.worker.ts', import.meta.url), { type: 'module' })

      return new Promise<GroupedResults>((resolve, reject) => {
        if (!worker) {
          isChecking.value = false
          reject(new Error('Worker creation failed'))
          return
        }

        // Handle messages from the worker
        worker.onmessage = (event) => {
          const data = event.data as {
            type: 'progress' | 'result' | 'error';
            progress?: number;
            progressState?: Partial<ProgressState>;
            results?: DomainResult[];
            message?: string;
            domain?: string;
          };

          switch (data.type) {
            case 'progress':
              if (data.progressState) {
                // Update the progress state with the worker's progress info
                progress.value = {
                  ...progress.value,
                  ...data.progressState,
                }
              } else if (typeof data.progress === 'number') {
                // Legacy support for older worker implementation
                progress.value = {
                  ...progress.value,
                  percentage: data.progress,
                  currentDomain: data.domain
                };
              }
              break;
            case 'result':
              if (Array.isArray(data.results)) {
                // Update the results array
                results.splice(0, results.length, ...data.results);
                
                // Cache the results
                cache.value[cacheKey] = {
                  results: JSON.parse(JSON.stringify(data.results)),
                  timestamp: Date.now()
                };
              }
              
              // Set final progress state
              progress.value = {
                percentage: 100,
                stage: CheckStage.COMPLETE,
                domainsProcessed: sortedTLDs.length,
                totalDomains: sortedTLDs.length,
                detailedMessage: 'All domain checks complete'
              };
              
              isChecking.value = false;
              
              // Clean up worker
              cleanupWorker();
              
              // Return the results
              resolve(groupedResults.value);
              break;
            case 'error':
              console.error(`[Domain Check Worker] ${data.message || 'Unknown error'}`);
              
              // If it's a per-domain error, we might continue
              if (data.domain) {
                console.warn(`[Domain Check Worker] Error checking ${data.domain}, continuing with other domains...`);
                progress.value.detailedMessage = `Error checking ${data.domain}`;
              } else {
                // Global worker error, abort
                isChecking.value = false;
                cleanupWorker();
                reject(new Error(data.message || 'Unknown worker error'));
              }
              break;
          }
        };

        // Handle worker errors
        worker.onerror = (error: ErrorEvent) => {
          console.error('[Domain Check Worker] Error:', error);
          isChecking.value = false;
          cleanupWorker();
          reject(new Error('Worker error: ' + (error.message || 'Unknown error')));
        };

        // Send the check request to the worker
        worker.postMessage({
          domainName,
          tlds: sortedTLDs
        })
      })
    } catch (error) {
      // Handle any errors in worker setup
      isChecking.value = false
      cleanupWorker()
      console.error('[Domain Check] Worker initialization failed:', error)
      
      // Fall back to standard implementation
      console.info('[Domain Check] Falling back to standard implementation')
      return checkDomainsStandard(domainName, selectedTLDs)
    }
  }

  // Original standard implementation
  const checkDomainsStandard = async (domainName: string, selectedTLDs: string[]) => {
    // Sort TLDs for consistent cache key
    const sortedTLDs = [...selectedTLDs].sort()
    const cacheKey = `${domainName}:${sortedTLDs.join(',')}`
    const cachedEntry = cache.value[cacheKey]

    // Check cache
    if (cachedEntry && Date.now() - cachedEntry.timestamp < 5 * 60 * 1000) { // 5 min cache
      results.splice(0, results.length, ...cachedEntry.results)
      console.info(`[Domain Check] Cache hit for ${domainName} with TLDs: ${sortedTLDs.join(',')}`)
      return groupedResults.value
    }
    console.info(`[Domain Check] Cache miss or expired for ${domainName} with TLDs: ${sortedTLDs.join(',')}`)

    // Reset state
    results.splice(0, results.length) // Clear previous results using splice for reactivity
    progress.value = {
      percentage: 0,
      stage: CheckStage.PREPARING,
      domainsProcessed: 0,
      totalDomains: sortedTLDs.length
    }
    isChecking.value = true

    const totalDomains = sortedTLDs.length
    const domainCheckPromises: Promise<DomainResult>[] = []
    
    // Pre-calculate total percentage allocation per domain
    const domainPercentage = 100 / totalDomains
    
    // Track processed domains to update progress
    let processedDomains = 0

    for (const tld of sortedTLDs) {
      const fullDomain = `${domainName}${tld}`
      
      // Update progress to show current domain
      progress.value = {
        ...progress.value,
        percentage: (processedDomains / totalDomains) * 95, // Leave 5% for finalization
        currentDomain: fullDomain,
        stage: CheckStage.WILDCARD_CHECK,
        detailedMessage: `Starting check for ${fullDomain}`,
      }
      
      // Create a promise that updates progress during execution
      const domainPromise = (async () => {
        try {
          // WILDCARD CHECK PHASE
          progress.value = {
            ...progress.value,
            percentage: (processedDomains / totalDomains) * 95 + (domainPercentage * 0.1),
            currentDomain: fullDomain,
            stage: CheckStage.WILDCARD_CHECK,
            detailedMessage: `Checking wildcard DNS for ${fullDomain}`,
          }
          
          // PRIMARY QUERIES PHASE
          progress.value = {
            ...progress.value,
            percentage: (processedDomains / totalDomains) * 95 + (domainPercentage * 0.3),
            currentDomain: fullDomain,
            stage: CheckStage.PRIMARY_QUERY,
            detailedMessage: `Querying DNS providers for ${fullDomain}`,
          }
          
          // Potential FALLBACK PHASE
          progress.value = {
            ...progress.value,
            percentage: (processedDomains / totalDomains) * 95 + (domainPercentage * 0.6),
            currentDomain: fullDomain,
            stage: CheckStage.FALLBACK_QUERY,
            detailedMessage: `Performing additional DNS checks for ${fullDomain}`,
          }
          
          // ANALYSIS PHASE
          progress.value = {
            ...progress.value,
            percentage: (processedDomains / totalDomains) * 95 + (domainPercentage * 0.8),
            currentDomain: fullDomain,
            stage: CheckStage.ANALYZING,
            detailedMessage: `Analyzing DNS responses for ${fullDomain}`,
          }
          
          // Actually perform the check (this encapsulates all the above phases)
          const result = await checkDomainAvailability(fullDomain)
          
          // Update processed count for next iteration
          processedDomains++
          progress.value = {
            ...progress.value,
            domainsProcessed: processedDomains,
            percentage: (processedDomains / totalDomains) * 95,
            currentDomain: fullDomain,
            stage: CheckStage.FINALIZING,
            detailedMessage: `Completed check for ${fullDomain}: ${statusMessages[result.status]}`
          }
          
          return result
        } catch (error) {
          // Handle errors but still update progress
          processedDomains++
          progress.value = {
            ...progress.value,
            domainsProcessed: processedDomains,
            percentage: (processedDomains / totalDomains) * 95,
            detailedMessage: `Error checking ${fullDomain}`
          }
          
          // This catch block handles errors during checkDomainAvailability
          const { category, message, suggestsDomainExists } = handleError(
            'Domain check failed (outer)',
            error as Error,
            fullDomain
          )
          const status = suggestsDomainExists ? DomainAvailabilityStatus.REGISTERED : DomainAvailabilityStatus.ERROR
          return {
            domain: fullDomain,
            status: status,
            error: status === DomainAvailabilityStatus.ERROR,
            errorCategory: category,
            errorMessage: message,
            link: generateLink(fullDomain, status),
            confidenceReasons: [
              `Error during check: ${message}`,
              suggestsDomainExists ? 'Error type suggests domain might be registered.' : 'Could not determine status.'
            ],
            dnssecValidated: undefined,
            wildcardDetected: undefined,
            isParkedByNs: false,
            isParkedByTxt: false
          }
        }
      })()
      
      // Add the promise to our collection
      domainCheckPromises.push(domainPromise)
    }

    progress.value = {
      ...progress.value,
      stage: CheckStage.FINALIZING,
      detailedMessage: 'Waiting for all domain queries to complete...'
    }

    // Wait for all domain checks to complete
    const settledResults = await Promise.allSettled(domainCheckPromises)

    const finalResults: DomainResult[] = settledResults.map((result, index) => {
      const fullDomain = `${domainName}${sortedTLDs[index]}`
      if (result.status === 'fulfilled') {
        return result.value
      } else {
        // Handle unexpected errors from the checkDomainAvailability promise itself (should be rare)
        console.error(`[Domain Check] Unexpected rejection for ${fullDomain}:`, result.reason)
        const { category, message } = handleError(
          'Unexpected domain check failure',
          result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
          fullDomain
        )
        return {
          domain: fullDomain,
          status: DomainAvailabilityStatus.ERROR,
          error: true,
          errorCategory: category,
          errorMessage: `Unexpected error: ${message}`,
          link: generateLink(fullDomain, DomainAvailabilityStatus.ERROR),
          confidenceReasons: ['An unexpected error occurred during the check.'],
          dnssecValidated: undefined,
          wildcardDetected: undefined,
          isParkedByNs: false,
          isParkedByTxt: false
        }
      }
    })

    results.splice(0, results.length, ...finalResults)
    
    // Update final progress
    progress.value = {
      percentage: 100,
      stage: CheckStage.COMPLETE,
      domainsProcessed: totalDomains,
      totalDomains: totalDomains,
      detailedMessage: 'All domain checks complete'
    }
    
    isChecking.value = false

    cache.value[cacheKey] = {
      results: JSON.parse(JSON.stringify(finalResults)),
      timestamp: Date.now()
    }
    console.info(`[Domain Check] Caching results for ${domainName} with TLDs: ${sortedTLDs.join(',')}`)

    return groupedResults.value
  }

  const checkDomainAvailability = async (domain: string): Promise<DomainResult> => {
    // Use the PRIMARY_PROVIDER_URLS instead of the first 2 providers from DOH_PROVIDER_URLS
    if (PRIMARY_PROVIDER_URLS.length === 0) {
      throw new Error("No primary DoH providers configured.");
    }

    // Check if domain has a known wildcard TLD
    const tld = domain.substring(domain.indexOf('.'));
    const isKnownWildcardTld = KNOWN_WILDCARD_TLDS.has(tld);
    
    let isWildcard = false;
    let wildcardCheckError: string | undefined = undefined;
    const initialConfidenceReasons: string[] = [];

    // Add known wildcard TLD to initial reasons if applicable
    if (isKnownWildcardTld) {
      initialConfidenceReasons.push(`Domain uses TLD (${tld}) known to commonly implement wildcards.`);
    }

    // 1. Wildcard Check (using a rotating provider)
    try {
      isWildcard = await checkWildcardDNS(domain);
      if (isWildcard) {
        initialConfidenceReasons.push('Wildcard DNS detected (often used for parking/catch-alls).');
      }
    } catch (error) {
      const { message } = handleError('Wildcard check', error as Error, domain);
      wildcardCheckError = `Wildcard detection failed: ${message}`;
      initialConfidenceReasons.push(wildcardCheckError); // Log failure reason
      // Non-fatal: proceed with the check, but note the detection failure.
    }

    // Prepare to collect results from different query types and providers
    const allProviderResults: Array<
      { status: 'fulfilled', value: DoHJsonResponse, provider: string, queryType: number } |
      { status: 'rejected', reason: Error, provider: string, queryType: number, errorCategory?: ErrorCategory, errorMessage?: string, suggestsDomainExists?: boolean }
    > = [];
    let errorsIndicatingDomainExists = 0;

    // 2. Perform NS and TXT queries in parallel using PRIMARY_PROVIDER_URLS
    const queryPromises = PRIMARY_PROVIDER_URLS.flatMap(providerUrl => {
      const providerConfig = getProviderConfigFromUrl(providerUrl);
      const providerName = providerConfig?.name ?? 'Unknown Provider';

      const nsPromise = fetchDnsJson(providerUrl, domain, DNS_RECORD_TYPE_NS)
        .then(data => ({ status: 'fulfilled' as const, value: data, provider: providerName, queryType: DNS_RECORD_TYPE_NS }))
        .catch(error => {
          const { category, message, suggestsDomainExists } = handleError(`NS query from ${providerName}`, error as Error, domain);
          if (suggestsDomainExists) errorsIndicatingDomainExists++;
          return { status: 'rejected' as const, reason: error as Error, provider: providerName, queryType: DNS_RECORD_TYPE_NS, errorCategory: category, errorMessage: message, suggestsDomainExists };
        });

      const txtPromise = fetchDnsJson(providerUrl, domain, DNS_RECORD_TYPE_TXT)
        .then(data => ({ status: 'fulfilled' as const, value: data, provider: providerName, queryType: DNS_RECORD_TYPE_TXT }))
        .catch(error => {
          // Don't double-count errors suggesting existence if NS already failed similarly,
          // but log the TXT query failure. TXT failures are less indicative of existence.
          const { category, message } = handleError(`TXT query from ${providerName}`, error as Error, domain);
          return { status: 'rejected' as const, reason: error as Error, provider: providerName, queryType: DNS_RECORD_TYPE_TXT, errorCategory: category, errorMessage: message, suggestsDomainExists: false }; // Assume TXT errors don't strongly suggest existence
        });

      return [nsPromise, txtPromise];
    });

    const nsTxtResults = await Promise.all(queryPromises);
    allProviderResults.push(...nsTxtResults);

    // 3. Fallback to SOA if NS queries were inconclusive (and TXT didn't help clarify)
    // Only consider NS results for the SOA fallback decision
    const nsResultsOnly = allProviderResults.filter(r => r.queryType === DNS_RECORD_TYPE_NS);
    const needSoaFallback = nsResultsOnly.every(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value.Status !== DNS_STATUS_NOERROR && r.value.Status !== DNS_STATUS_NXDOMAIN));

    if (needSoaFallback) {
      console.info(`[Domain Check] NS/TXT queries inconclusive for ${domain}, trying SOA records.`);
      initialConfidenceReasons.push('NS/TXT queries were inconclusive, falling back to SOA check.');
      const soaPromises = PRIMARY_PROVIDER_URLS.map(providerUrl => {
        const providerConfig = getProviderConfigFromUrl(providerUrl);
        const providerName = providerConfig?.name ?? 'Unknown Provider';
        return fetchDnsJson(providerUrl, domain, DNS_RECORD_TYPE_SOA)
          .then(data => ({ status: 'fulfilled' as const, value: data, provider: providerName, queryType: DNS_RECORD_TYPE_SOA }))
          .catch(error => {
            const { category, message, suggestsDomainExists } = handleError(`SOA query from ${providerName}`, error as Error, domain);
            if (suggestsDomainExists) errorsIndicatingDomainExists++;
            return { status: 'rejected' as const, reason: error as Error, provider: providerName, queryType: DNS_RECORD_TYPE_SOA, errorCategory: category, errorMessage: message, suggestsDomainExists };
          });
      });
      const soaResults = await Promise.all(soaPromises);
      allProviderResults.push(...soaResults); // Add SOA results for interpretation
    }

    // 4. Interpret combined results (including NS, TXT, potential SOA, wildcard status, and known wildcard TLD)
    return interpretCombinedResults(domain, allProviderResults, isWildcard, isKnownWildcardTld, errorsIndicatingDomainExists, initialConfidenceReasons);
  }

  // Interprets the collective results from NS/SOA queries across providers
const interpretCombinedResults = (
    domain: string,
    providerResults: Array<
        { status: 'fulfilled', value: DoHJsonResponse, provider: string, queryType: number } |
        { status: 'rejected', reason: Error, provider: string, queryType: number, errorCategory?: ErrorCategory, errorMessage?: string, suggestsDomainExists?: boolean }
    >,
    isWildcard: boolean,
    isKnownWildcardTld: boolean,
    totalErrorsSuggestingDomainExists: number,
    initialReasons: string[]
): DomainResult => {
    const reasons = [...initialReasons]
    let finalStatus: DomainAvailabilityStatus = DomainAvailabilityStatus.INDETERMINATE

    let nxDomainCount = 0
    let noErrorWithRecordsCount = 0 // NOERROR response with NS/SOA records
    let noErrorWithoutRecordsCount = 0 // NOERROR but no relevant records
    let servFailCount = 0
    let otherDnsErrorCount = 0
    let networkOrTimeoutErrorCount = 0
    let dnssecValidated = false
    let parkedNsCount = 0 // Count providers reporting parked NS
    const txtAnalysisResults = new Map<string, ReturnType<typeof analyzeTxtRecordsForParking>>() // Updated type
    let primaryErrorCategory: ErrorCategory | undefined = undefined
    let primaryErrorMessage: string | undefined = undefined
    let hasActiveUsageIndicators = false // Track active usage indicators

    const processedProviders = new Set<string>()
    const nsResponses = new Map<string, string[]>() // Store NS records per provider
    const primaryProviderNames = PRIMARY_PROVIDER_URLS.map(url => {
        const config = getProviderConfigFromUrl(url);
        return config?.name ?? 'Unknown';
    });

    // Collect primary provider results for consensus checks
    const primaryProviderResults = providerResults.filter(r => primaryProviderNames.includes(r.provider));
    
    // Process all results
    providerResults.forEach(result => {
        processedProviders.add(result.provider)
        const queryTypeText = result.queryType === DNS_RECORD_TYPE_NS ? 'NS' : (result.queryType === DNS_RECORD_TYPE_SOA ? 'SOA' : 'TXT');
        const isPrimaryProvider = primaryProviderNames.includes(result.provider);

        if (result.status === 'fulfilled') {
            const data = result.value
            const statusText = DNS_STATUS_MESSAGES[data.Status] || `Unknown Status ${data.Status}`
            reasons.push(`Provider ${result.provider}${isPrimaryProvider ? ' (Primary)' : ''} (${queryTypeText}): ${statusText}${data.Comment ? ` (${data.Comment})` : ''}`)

            if (data.Status === DNS_STATUS_NXDOMAIN) {
                nxDomainCount++
            } else if (data.Status === DNS_STATUS_NOERROR) {
                const hasNsOrSoaRecords =
                    (data.Answer?.some(r => r.type === DNS_RECORD_TYPE_NS || r.type === DNS_RECORD_TYPE_SOA)) ||
                    (data.Authority?.some(r => r.type === DNS_RECORD_TYPE_NS || r.type === DNS_RECORD_TYPE_SOA))

                if (hasNsOrSoaRecords) {
                    noErrorWithRecordsCount++
                    reasons.push(` -> Found NS/SOA records.`)
                } else {
                     noErrorWithoutRecordsCount++
                    reasons.push(` -> No confirming NS/SOA records found despite NOERROR.`)
                }

                // Check NS records for parking
                if (result.queryType === DNS_RECORD_TYPE_NS && data.Answer) {
                    const currentNsList: string[] = []
                    let providerReportsParkedNs = false;
                    data.Answer.forEach(record => {
                        if (record.type === DNS_RECORD_TYPE_NS && typeof record.data === 'string') {
                             const nameserver = record.data.toLowerCase().replace(/\.$/, ''); // Normalize
                            currentNsList.push(nameserver);
                            if (PARKING_NAMESERVERS.has(nameserver)) {
                                providerReportsParkedNs = true;
                                reasons.push(` -> Found parking nameserver: ${record.data}`);
                            }
                        }
                    });
                    nsResponses.set(result.provider, currentNsList);
                    if (providerReportsParkedNs) {
                        parkedNsCount++;
                    }
                }

                // Analyze TXT records using the updated function
                if (result.queryType === DNS_RECORD_TYPE_TXT) {
                     const analysis = analyzeTxtRecordsForParking(data);
                     txtAnalysisResults.set(result.provider, analysis); // Store full analysis
                     if (analysis.matchedPatterns.length > 0) {
                          reasons.push(` -> Found patterns: [${analysis.matchedPatterns.join(', ')}] (Confidence: ${analysis.confidence})`);
                     }
                     
                     // Check for active usage indicators
                     if (analysis.hasActiveUsageIndicators) {
                         hasActiveUsageIndicators = true;
                         reasons.push(` -> Found active domain usage indicators (verifications)`);
                     }
                }

            } else if (data.Status === DNS_STATUS_SERVFAIL) {
                servFailCount++
                 if (!primaryErrorCategory) { // Capture first significant error
                    primaryErrorCategory = ErrorCategory.DNS_ERROR
                    primaryErrorMessage = `DNS server failure (SERVFAIL) reported by ${result.provider}`
                }
            } else { // Other DNS status codes (FORMERR, NOTIMP, REFUSED etc.)
                 otherDnsErrorCount++
                 reasons.push(` -> DNS error code ${data.Status}.`)
                 if (!primaryErrorCategory) {
                    primaryErrorCategory = ErrorCategory.DNS_ERROR
                    primaryErrorMessage = `DNS error ${statusText} reported by ${result.provider}`
                }
            }

            if (data.AD) { // DNSSEC Authenticated Data flag
                dnssecValidated = true // Mark if any provider confirms DNSSEC
                reasons.push(` -> DNSSEC validated (AD flag).`)
            }
        } else { // status === 'rejected'
            const category = result.errorCategory || ErrorCategory.UNKNOWN
            const message = result.errorMessage || 'Unknown error'
             reasons.push(`Provider ${result.provider}${isPrimaryProvider ? ' (Primary)' : ''} (${queryTypeText}): Error - ${message}`)

            if (category === ErrorCategory.NETWORK || category === ErrorCategory.TIMEOUT) {
                networkOrTimeoutErrorCount++
            } else {
                // Treat other errors (likely DNS related) similarly to DNS status errors
                otherDnsErrorCount++
            }

            // Capture first significant error message/category
            if (!primaryErrorCategory) {
                primaryErrorCategory = category
                primaryErrorMessage = message
            }

            if (result.suggestsDomainExists) {
                reasons.push(` -> This error type sometimes occurs with registered domains.`)
            }
        }
    })

    const totalResponses = providerResults.length
    const distinctProviderResponses = processedProviders.size // How many unique providers gave *some* result
    const consensusThreshold = Math.max(1, Math.ceil(distinctProviderResponses / 2)); // Need >50% consensus from responders

    // Primary provider consensus check (crucial for high confidence)
    const primaryProviderCount = primaryProviderNames.length;
    const primaryProviderResponses = primaryProviderResults.length;
    
    // Calculate specific primary provider response characteristics
    const primaryNxDomainCount = primaryProviderResults.filter(r => 
      r.status === 'fulfilled' && r.value.Status === DNS_STATUS_NXDOMAIN
    ).length;
    
    const primaryNoErrorWithRecordsCount = primaryProviderResults.filter(r => 
      r.status === 'fulfilled' && 
      r.value.Status === DNS_STATUS_NOERROR && 
      (r.value.Answer?.some(rec => rec.type === DNS_RECORD_TYPE_NS || rec.type === DNS_RECORD_TYPE_SOA) ||
       r.value.Authority?.some(rec => rec.type === DNS_RECORD_TYPE_NS || rec.type === DNS_RECORD_TYPE_SOA))
    ).length;
    
    // Calculate if we have a strong consensus among primary providers
    const primaryNxDomainConsensus = primaryNxDomainCount === primaryProviderCount && primaryProviderCount > 1;
    const anyPrimaryNoErrorWithRecords = primaryNoErrorWithRecordsCount > 0;

    // Calculate TXT pattern consensus across all providers
    let parkedTxtConsensusCount = 0;
    let uniqueMatchedTxtPatterns = new Set<string>();
    txtAnalysisResults.forEach(analysis => {
        if (analysis.isParked) parkedTxtConsensusCount++;
        analysis.matchedPatterns.forEach(p => uniqueMatchedTxtPatterns.add(p));
    });

    // Calculate Premium TXT signal consensus
    let premiumTxtConsensusCount = 0;
    let uniquePremiumTxtPatterns = new Set<string>();
    txtAnalysisResults.forEach(analysis => {
        if (analysis.isPremium) {
            premiumTxtConsensusCount++;
            // Add only premium-related patterns if distinguishable
            analysis.matchedPatterns.filter(p => 
                p.toLowerCase().includes('premium') || 
                p.toLowerCase().includes('sale') ||
                p.toLowerCase().includes('broker')
            ).forEach(p => uniquePremiumTxtPatterns.add(p));
        }
    });

    // Determine strong consensus thresholds
    const hasPremiumTxtSignalConsensus = premiumTxtConsensusCount >= consensusThreshold && premiumTxtConsensusCount > 0;
    
    // Check for strong parking signals (consensus-based)
    const hasStrongParkingSignal =
      parkedNsCount >= consensusThreshold ||
      parkedTxtConsensusCount >= consensusThreshold ||
      (isWildcard && (parkedNsCount > 0 || parkedTxtConsensusCount > 0)); // Wildcard + any parking signal is strong

    // Priority 1: Domain with active usage verification should be marked registered (regardless of other signals)
    if (hasActiveUsageIndicators) {
        finalStatus = DomainAvailabilityStatus.REGISTERED;
        reasons.push("High Confidence: Found active usage indicators (verification TXT records), domain is in use.");
        
        // Add additional context if we also have other signals
        if (noErrorWithRecordsCount > 0) {
            reasons.push("-> Also confirmed by NS/SOA records.");
        }
        
        // Still note parking signals if present
        if (hasStrongParkingSignal) {
            reasons.push(`-> Domain also shows parking signals (NS: ${parkedNsCount}, TXT Park: ${parkedTxtConsensusCount}, Wildcard: ${isWildcard}).`);
        }
    }
    // Priority 2: Conclusive Registered (NOERROR + Records)
    else if (noErrorWithRecordsCount > 0) {
        finalStatus = DomainAvailabilityStatus.REGISTERED;
        reasons.push("High Confidence: Found authoritative NS/SOA records, indicating the domain is registered.");
        // Add parking/premium *hints* based on NS/TXT, but don't change status to PREMIUM here
        if (hasStrongParkingSignal) {
            reasons.push(`-> Domain appears potentially parked/premium based on NS/TXT signals. (NS: ${parkedNsCount}, TXT Park: ${parkedTxtConsensusCount}, TXT Premium: ${premiumTxtConsensusCount}, Wildcard: ${isWildcard}). Matched Premium TXT: [${Array.from(uniquePremiumTxtPatterns).join(', ')}]`);
        } else if (hasPremiumTxtSignalConsensus) {
             reasons.push(`-> Premium TXT patterns detected by consensus, potentially indicating a premium domain for sale. Matched TXT: [${Array.from(uniquePremiumTxtPatterns).join(', ')}]`);
        }
    }
    // Priority 3: Conclusive Available (NXDOMAIN Consensus, No Wildcard/Conflicts)
    else if (nxDomainCount > 0 && noErrorWithRecordsCount === 0 && servFailCount === 0) {
         if (!isWildcard && nxDomainCount >= distinctProviderResponses) {
            finalStatus = DomainAvailabilityStatus.AVAILABLE;
            reasons.push("High Confidence: All responding providers reported NXDOMAIN (Not Found) without conflicting signals.");
             // *After* determining available, check if TXT suggested premium (unlikely but possible for misconfigured available domains)
             if (hasPremiumTxtSignalConsensus) {
                 reasons.push(`-> Warning: Domain appears available (NXDOMAIN), but conflicting Premium TXT patterns were detected. Status uncertain. Matched TXT: [${Array.from(uniquePremiumTxtPatterns).join(', ')}]`);
                 finalStatus = DomainAvailabilityStatus.INDETERMINATE; // Downgrade confidence
             }
        } else if (!isWildcard && nxDomainCount > 0 && (nxDomainCount + networkOrTimeoutErrorCount + otherDnsErrorCount) >= distinctProviderResponses) {
             finalStatus = DomainAvailabilityStatus.AVAILABLE;
             reasons.push("Moderate Confidence: At least one provider reported NXDOMAIN with no conflicting registration signals.");
              if (hasPremiumTxtSignalConsensus) {
                 reasons.push(`-> Warning: Domain appears available (NXDOMAIN), but conflicting Premium TXT patterns were detected. Status uncertain. Matched TXT: [${Array.from(uniquePremiumTxtPatterns).join(', ')}]`);
                 finalStatus = DomainAvailabilityStatus.INDETERMINATE; // Downgrade confidence
             }
        } else if (isWildcard) {
            // If NXDOMAIN + Wildcard, check for strong parking/premium TXT signals
            if (hasStrongParkingSignal || hasPremiumTxtSignalConsensus) {
                 finalStatus = DomainAvailabilityStatus.REGISTERED; // Wildcard + Parking/Premium hints usually means registered/parked
                 reasons.push("Low Confidence: NXDOMAIN with wildcard, but strong parking/premium TXT/NS signals suggest it's likely registered/parked.");
                 if (hasPremiumTxtSignalConsensus) reasons.push(`-> Premium TXT patterns detected: [${Array.from(uniquePremiumTxtPatterns).join(', ')}]`);
            } else {
                 finalStatus = DomainAvailabilityStatus.INDETERMINATE;
                 reasons.push("Low Confidence: NXDOMAIN received, but wildcard detection makes status uncertain without parking/premium signals.");
            }
        } else {
             finalStatus = DomainAvailabilityStatus.INDETERMINATE;
             reasons.push("Low Confidence: Mixed results including NXDOMAIN, status uncertain.");
        }
    }
    // Priority 4: Premium based ONLY on TXT Consensus (if not already Registered/Available)
    else if (hasPremiumTxtSignalConsensus && noErrorWithRecordsCount === 0 && nxDomainCount === 0 ) {
         finalStatus = DomainAvailabilityStatus.PREMIUM;
         reasons.push(`Moderate Confidence: Premium status inferred primarily from consensus on specific TXT records indicating domain is for sale/premium. Matched TXT: [${Array.from(uniquePremiumTxtPatterns).join(', ')}]`);
          if (hasStrongParkingSignal && !reasons[reasons.length-1].includes("Parking signals")) { // Add parking info if relevant and not redundant
             reasons.push(`-> Parking signals also detected (NS: ${parkedNsCount}, TXT Park: ${parkedTxtConsensusCount}, Wildcard: ${isWildcard}), supporting premium/reserved classification.`);
         }
    }
    // Priority 5: Likely Registered (SERVFAIL, errors suggesting existence, OR strong parking without clear NOERROR/NXDOMAIN/PremiumTXT)
    else if (servFailCount > 0 || (totalErrorsSuggestingDomainExists >= consensusThreshold && distinctProviderResponses > 0) || (hasStrongParkingSignal && noErrorWithRecordsCount === 0 && nxDomainCount === 0)) {
        finalStatus = DomainAvailabilityStatus.REGISTERED;
        if (servFailCount > 0) {
            reasons.push("Moderate Confidence: DNS server failures (SERVFAIL) often occur with registered but misconfigured domains.");
        } else if (totalErrorsSuggestingDomainExists >= consensusThreshold) {
            reasons.push("Moderate Confidence: Multiple errors suggesting domain likely exists but has DNS issues.");
        } else {
            reasons.push("Moderate Confidence: Strong parking signals without clear NOERROR/NXDOMAIN suggest domain is registered and parked.");
        }
    }
    // Priority 6: Indeterminate
     else if (noErrorWithoutRecordsCount > 0) {
        finalStatus = DomainAvailabilityStatus.INDETERMINATE;
        reasons.push("Low Confidence: Received NOERROR status but without confirming NS/SOA records. Status uncertain.");
         if (isWildcard) reasons.push("-> Wildcard DNS detected, adding to uncertainty.");
    }
    // Priority 7: Error
    else if ((networkOrTimeoutErrorCount + otherDnsErrorCount) === totalResponses && totalResponses > 0) {
        finalStatus = DomainAvailabilityStatus.ERROR;
        reasons.push("Error: Failed to get conclusive DNS status due to network issues or server errors.");
    } else {
        // Default fallback
        finalStatus = DomainAvailabilityStatus.INDETERMINATE;
         reasons.push("Indeterminate: Could not determine a confident status based on mixed or inconclusive results.");
        if ((networkOrTimeoutErrorCount + otherDnsErrorCount + servFailCount) === totalResponses && totalResponses > 0) {
             finalStatus = DomainAvailabilityStatus.ERROR;
        }
    }

    return {
        domain,
        status: finalStatus,
        error: finalStatus === DomainAvailabilityStatus.ERROR,
        errorCategory: finalStatus === DomainAvailabilityStatus.ERROR ? primaryErrorCategory : undefined,
        errorMessage: finalStatus === DomainAvailabilityStatus.ERROR ? primaryErrorMessage : undefined,
        link: generateLink(domain, finalStatus),
        confidenceReasons: reasons,
        dnssecValidated,
        wildcardDetected: isWildcard || isKnownWildcardTld,
        isParkedByNs: parkedNsCount >= consensusThreshold,
        isParkedByTxt: parkedTxtConsensusCount >= consensusThreshold
    }
}

  // Generates a relevant link based on domain status
 const generateLink = (domain: string, status: DomainAvailabilityStatus): string => {
    const tld = '.' + domain.split('.').pop() // Extract TLD (e.g., ".com")

    // Default fallback link provider
    let registrarBaseUrl = `https://domainr.com/` // General info / broad registrar support

     // Use Namecheap specifically for TLDs they support
    if (tld && namecheapTLDs.includes(tld)) {
      registrarBaseUrl = `https://www.namecheap.com/domains/registration/results/?domain=`
    }

    switch (status) {
      case DomainAvailabilityStatus.REGISTERED:
        // Link to the live site (assuming http)
        // Basic check to avoid double protocols if somehow present
        return domain.startsWith('http') ? domain : `http://${domain}`
      case DomainAvailabilityStatus.PREMIUM:
         // Link to a marketplace or registrar search page for premium
        if (tld && namecheapTLDs.includes(tld)) {
            return `${registrarBaseUrl}${domain}` // Namecheap handles premium display
        }
        // Fallback to a known marketplace for other TLDs
        return `https://dan.com/buy-domain/${domain}`
      case DomainAvailabilityStatus.AVAILABLE:
         // Link to registrar search page
        return `${registrarBaseUrl}${domain}`
      case DomainAvailabilityStatus.INDETERMINATE:
      case DomainAvailabilityStatus.ERROR:
      default:
        // Link to a general info page like Domainr for uncertain cases
        return `https://domainr.com/${domain}`
    }
  }

  // Checks for wildcard DNS by querying a random subdomain
 const checkWildcardDNS = async (domain: string): Promise<boolean> => {
    // Generate a highly random string unlikely to exist
    const randomSubdomain = `check-${Math.random().toString(36).substring(2, 10)}-${Date.now().toString(36)}`
    const wildcardTestDomain = `${randomSubdomain}.${domain}`

    // Use a rotating provider for this check to distribute load/avoid bias
    const providerUrl = getNextProviderUrl()
    const providerConfig = getProviderConfigFromUrl(providerUrl)
    const providerName = providerConfig?.name ?? 'Unknown Provider'

    try {
      // Use 'A' record type as it's common for wildcards to resolve to an IP
      const data = await fetchDnsJson(providerUrl, wildcardTestDomain, DNS_RECORD_TYPE_A)

      // A wildcard is likely if a random subdomain resolves successfully (NOERROR)
      // AND provides an Answer (e.g., A record) or Authority (e.g., SOA record indicating zone exists)
      const hasResolvingAnswer = data.Answer?.some(r => [DNS_RECORD_TYPE_A, 5 /* CNAME */, 28 /* AAAA */].includes(r.type)) ?? false;
      const isWildcardDetected = data.Status === DNS_STATUS_NOERROR && hasResolvingAnswer;

      if (isWildcardDetected) {
        console.info(`[Domain Check] Wildcard detected for ${domain} via ${providerName} using ${wildcardTestDomain}`)
      } else {
         console.info(`[Domain Check] No wildcard detected for ${domain} via ${providerName} using ${wildcardTestDomain} (Status: ${data.Status}, Answers: ${data.Answer?.length ?? 0})`)
      }
      return isWildcardDetected

    } catch (error) {
       // Log the error but don't block the main check; treat as "wildcard not detected" or "detection failed"
      const { message } = handleError(`Wildcard Check (${providerName})`, error as Error, domain)
      console.warn(`[Domain Check] Wildcard check failed for ${domain} via ${providerName}: ${message}. Proceeding as non-wildcard.`)
      // Re-throw the error so the caller (checkDomainAvailability) knows the check failed
      throw error
    }
  }

  // Updated helper function to analyze TXT records for parking and premium domain patterns
  const analyzeTxtRecordsForParking = (data: DoHJsonResponse): {
    isParked: boolean,
    isPremium: boolean,
    confidence: number,
    matchedPatterns: string[],
    hasActiveUsageIndicators: boolean
  } => {
    if (!data.Answer || data.Answer.length === 0) {
        return { isParked: false, isPremium: false, confidence: 0, matchedPatterns: [], hasActiveUsageIndicators: false };
    }

    const patternsFound = new Set<string>();
    let hasSpf = false, hasDkim = false, hasDmarc = false,
        hasWildcard = false, hasRegistrarMarker = false, hasPremiumMarker = false,
        hasVerificationTxt = false;

    data.Answer.forEach(record => {
        if (record.type === DNS_RECORD_TYPE_TXT && typeof record.data === 'string') {
            const txtData = record.data.trim().replace(/^"|"$/g, '');
            const name = record.name.toLowerCase();

            // Helper function to safely test regex with more descriptive pattern naming
            const testPattern = (patterns: RegExp[], category: string) => {
                patterns.forEach(pattern => {
                    try {
                        if (pattern.test(txtData)) {
                            let patternDescription = '';
                            
                            // More descriptive pattern names based on category
                            switch(category) {
                                case 'SPF': 
                                    hasSpf = true; 
                                    patternDescription = "Restrictive SPF Policy (-all)"; 
                                    break;
                                case 'DKIM': 
                                    if (name.includes('_domainkey')) { 
                                        hasDkim = true; 
                                        patternDescription = "Null DKIM Configuration"; 
                                    }
                                    break;
                                case 'DMARC': 
                                    if (name.startsWith('_dmarc.') || name === '_dmarc') { 
                                        hasDmarc = true; 
                                        patternDescription = "Restrictive DMARC Policy"; 
                                    }
                                    break;
                                case 'REGISTRAR': 
                                    hasRegistrarMarker = true; 
                                    // Match more specific registrar patterns for better descriptions
                                    if (txtData.includes('parkingcrew')) {
                                        patternDescription = "ParkingCrew Parking Service";
                                    } else if (txtData.includes('sedoparking')) {
                                        patternDescription = "Sedo Parking Service";
                                    } else if (txtData.includes('domain_control_validation')) {
                                        patternDescription = "Domain Control Validation";
                                    } else {
                                        patternDescription = "Registrar Parking Marker";
                                    }
                                    break;
                                case 'PREMIUM':
                                    hasPremiumMarker = true;
                                    // Match more specific premium patterns for better descriptions
                                    if (pattern.toString().includes('premium')) {
                                        patternDescription = "Premium Domain Marker";
                                    } else if (pattern.toString().includes('for[-_]?sale')) {
                                        patternDescription = "Domain For Sale Marker";
                                    } else if (pattern.toString().includes('inquire')) {
                                        patternDescription = "Domain Purchase Inquiry";
                                    } else if (pattern.toString().includes('domainbroker')) {
                                        patternDescription = "Domain Broker Reference";
                                    } else if (pattern.toString().includes('reserve')) {
                                        patternDescription = "Reserved Domain";
                                    } else {
                                        patternDescription = "Generic Premium Domain Marker";
                                    }
                                    break;
                                case 'ACTIVE_USAGE':
                                    hasVerificationTxt = true;
                                    // Provide specific verification type descriptions
                                    if (pattern.toString().includes('google-site-verification')) {
                                        patternDescription = "Google Site Verification";
                                    } else if (pattern.toString().includes('ms=ms')) {
                                        patternDescription = "Microsoft Verification";
                                    } else if (pattern.toString().includes('facebook')) {
                                        patternDescription = "Facebook Domain Verification";
                                    } else if (pattern.toString().includes('apple')) {
                                        patternDescription = "Apple Domain Verification";
                                    } else if (pattern.toString().includes('docusign')) {
                                        patternDescription = "DocuSign Verification";
                                    } else if (pattern.toString().includes('stripe')) {
                                        patternDescription = "Stripe Verification";
                                    } else {
                                        patternDescription = "Service Verification TXT";
                                    }
                                    break;
                            }
                            
                            if (patternDescription) {
                                patternsFound.add(patternDescription);
                            }
                        }
                    } catch (e) {
                        console.error(`Regex error testing pattern ${pattern} on data: ${txtData}`, e);
                    }
                });
            };

            // Check for wildcard protection
            if (name.startsWith('*.') || name.includes('.*')) {
                if (!patternsFound.has("Wildcard DNS Protection")) { // Add only once
                    hasWildcard = true;
                    patternsFound.add("Wildcard DNS Protection");
                }
            }

            // Test each category
            testPattern(PARKING_PATTERNS.SPF, 'SPF');
            testPattern(PARKING_PATTERNS.DKIM, 'DKIM');
            testPattern(PARKING_PATTERNS.DMARC, 'DMARC');
            testPattern(PARKING_PATTERNS.REGISTRAR, 'REGISTRAR');
            testPattern(PARKING_PATTERNS.PREMIUM, 'PREMIUM');
            testPattern(PARKING_PATTERNS.ACTIVE_USAGE, 'ACTIVE_USAGE');
        }
    });

    // Calculate confidence score with weighted factors
    let confidence = 0;
    if (hasSpf) confidence += 25;
    if (hasDkim) confidence += 20;
    if (hasDmarc) confidence += 15;
    if (hasWildcard) confidence += 15;
    if (hasRegistrarMarker) confidence += 30; // Strongest signal for general parking
    confidence = Math.min(confidence, 100);

    // More refined determination of premium status
    const isParked = confidence >= 40;
    // Premium marker explicitly indicates a premium domain
    // OR high confidence parking with certain pattern combinations suggests premium/for sale
    const isPremium = hasPremiumMarker || 
                     (isParked && confidence >= 70 && 
                      (patternsFound.has("Domain For Sale Marker") || 
                       patternsFound.has("Domain Broker Reference")));

    return {
        isParked,
        isPremium,
        confidence,
        matchedPatterns: Array.from(patternsFound),
        hasActiveUsageIndicators: hasVerificationTxt
    };
  };


  return {
    checkDomains,
    results, // The reactive array of results
    progress,
    isChecking,
    groupedResults, // Computed property for easy filtering
    statusMessages, // Map of enum values to display strings
    stageMessages // Map of stages to descriptive messages
  }
}

// Convenience export with worker support enabled
export const useDomainCheckWithWorkers = () => useDomainCheck({ useWorkers: true });