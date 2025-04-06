import { namecheapTLDs } from '~/utils/tlds'
import { DohResolver, DnsStatusCode, DnsRecordType } from '~/utils/DohResolver'
import type { DnsResponse } from '~/utils/DohResolver'
import {
  PROVIDERS,
  PRIMARY_PROVIDER_URLS,
  DOH_PROVIDER_URLS,
  TIMEOUT_MS,
  MAX_RETRIES,
  KNOWN_WILDCARD_TLDS,
  getProviderConfigFromUrl,
  type ProviderConfig
} from '~/config/appConfig'

// --- Constants ---
export const DNS_STATUS_NOERROR = 0
export const DNS_STATUS_FORMERR = 1
export const DNS_STATUS_SERVFAIL = 2
export const DNS_STATUS_NXDOMAIN = 3
export const DNS_STATUS_NOTIMP = 4
export const DNS_STATUS_REFUSED = 5

export const DNS_RECORD_TYPE_A = 1
export const DNS_RECORD_TYPE_NS = 2
export const DNS_RECORD_TYPE_SOA = 6
export const DNS_RECORD_TYPE_TXT = 16
export const DNS_RECORD_TYPE_RRSIG = 46
export const DNS_RECORD_TYPE_NSEC3 = 50

// Error codes suggesting domain might exist despite failure
export const ERROR_CODES_SUGGESTING_DOMAIN_EXISTS = [
  DNS_STATUS_SERVFAIL, // Server Failure
  DNS_STATUS_REFUSED,  // Query Refused
];

// --- Re-export constants from config ---
export { 
  PROVIDERS,
  PRIMARY_PROVIDER_URLS,
  DOH_PROVIDER_URLS,
  TIMEOUT_MS, 
  MAX_RETRIES,
  KNOWN_WILDCARD_TLDS,
  getProviderConfigFromUrl
};
export type { ProviderConfig };

// --- Parking Detection Data ---
// Source: https://raw.githubusercontent.com/MISP/misp-warninglists/main/lists/parking-domain-ns/list.json
export const PARKING_NAMESERVERS = new Set([
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
export const PARKING_PATTERNS = {
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

// --- Enums and Types ---
export enum DomainAvailabilityStatus {
  AVAILABLE = 'available',
  REGISTERED = 'registered',
  PREMIUM = 'premium',
  INDETERMINATE = 'indeterminate',
  ERROR = 'error'
}

// Error categories
export enum ErrorCategory {
  NETWORK = 'network',
  TIMEOUT = 'timeout',
  DNS_ERROR = 'dns_error',
  UNKNOWN = 'unknown'
}

export interface DomainResult {
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

// DNS Status codes and their meanings
export const DNS_STATUS_MESSAGES: Record<number, string> = {
  [DNS_STATUS_NOERROR]: 'NOERROR (OK)',
  [DNS_STATUS_FORMERR]: 'FORMERR (Format Error)',
  [DNS_STATUS_SERVFAIL]: 'SERVFAIL (Server Failure)',
  [DNS_STATUS_NXDOMAIN]: 'NXDOMAIN (Name Error/Not Found)',
  [DNS_STATUS_NOTIMP]: 'NOTIMP (Not Implemented)',
  [DNS_STATUS_REFUSED]: 'REFUSED (Query Refused)',
};

// Centralized error handler
export const handleError = (context: string, error: Error, domain?: string): {
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
      suggestsDomainExists = true
    } else if (error instanceof TypeError && (error.message.includes('NetworkError') || error.message.includes('fetch'))) {
      category = ErrorCategory.NETWORK
      message = 'Network connection issue'
      suggestsDomainExists = false
    } else if (error.message.includes('status')) { // Likely an HTTP error from fetch
      category = ErrorCategory.DNS_ERROR
      const statusMatch = error.message.match(/status (\d+)/)
      const httpStatus = statusMatch ? parseInt(statusMatch[1], 10) : null

      if (httpStatus && [500, 502, 503, 504].includes(httpStatus)) {
        message = `DoH provider server error (${httpStatus})`
        suggestsDomainExists = true
      } else if (httpStatus) {
        message = `DoH query failed with HTTP ${httpStatus}`
        suggestsDomainExists = false
      } else {
        message = 'DoH server error (Unknown Status)'
        suggestsDomainExists = false
      }
    } else if (error.message.includes('SERVFAIL') || error.message.includes('Server Failure')) {
      category = ErrorCategory.DNS_ERROR
      message = 'DNS server failed to process the query (SERVFAIL)'
      suggestsDomainExists = true
    } else {
       category = ErrorCategory.DNS_ERROR
       message = `DNS lookup error: ${error.message}`
       suggestsDomainExists = false
    }

    // Logging can be handled by the caller (composable or worker) if needed
    // console.warn(`[Domain Check Error] Context: ${context}, Domain: ${domain || 'N/A'}, Category: ${category}, Message: ${message}, OriginalError:`, error)

    return { category, message, suggestsDomainExists }
  }

// DNS Fetching Logic
export const fetchDnsJson = async (providerUrl: string, domain: string, recordType: number): Promise<DoHJsonResponse> => {
    const config = getProviderConfigFromUrl(providerUrl);
    if (!config) {
      throw new Error(`Configuration error: Unknown DNS provider URL: ${providerUrl}`);
    }

    let attempts = 0;
    let lastError: Error | null = null;

    while (attempts <= MAX_RETRIES) {
      try {
        const resolver = new DohResolver(config.baseUrl);

        let recordTypeStr: string;
        switch (recordType) {
          case DNS_RECORD_TYPE_NS: recordTypeStr = 'NS'; break;
          case DNS_RECORD_TYPE_SOA: recordTypeStr = 'SOA'; break;
          case DNS_RECORD_TYPE_TXT: recordTypeStr = 'TXT'; break;
          case DNS_RECORD_TYPE_A: recordTypeStr = 'A'; break;
          default: recordTypeStr = recordType.toString();
        }

        const data = await resolver.query(
          domain,
          recordType,
          'GET',
          config.headers,
          TIMEOUT_MS
        ) as DoHJsonResponse;

        if (ERROR_CODES_SUGGESTING_DOMAIN_EXISTS.includes(data.Status)) {
          data.Comment = `DNS server returned ${DNS_STATUS_MESSAGES[data.Status] || 'error code ' + data.Status}. This often happens with registered domains.`
        }

        return data;
      } catch (rawError) {
        const error = rawError instanceof Error ? rawError : new Error(String(rawError));
        lastError = error;
        attempts++;

        const isTimeout = error instanceof DOMException && error.name === 'AbortError' ||
                          error.message.toLowerCase().includes('timeout');
        const isTransientServerError = error.message.includes('status') &&
                                       /status (50[234])/.test(error.message);

        if ((isTimeout || isTransientServerError) && attempts <= MAX_RETRIES) {
          console.warn(`[Domain Check Logic] Retrying query for ${domain} (${recordType}) with ${config.name} (Attempt ${attempts}/${MAX_RETRIES}) after error: ${error.message}`);
          await new Promise(resolve => setTimeout(resolve, 200));
          continue;
        }
        break;
      }
    }

    if (lastError) {
      throw lastError;
    } else {
      throw new Error('Unknown error during DNS fetch');
    }
}

// Analyze TXT Records
export const analyzeTxtRecordsForParking = (data: DoHJsonResponse): {
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

            const testPattern = (patterns: RegExp[], category: string) => {
                patterns.forEach(pattern => {
                    try {
                        if (pattern.test(txtData)) {
                            let patternDescription = '';
                            switch(category) {
                                case 'SPF': hasSpf = true; patternDescription = "Restrictive SPF Policy (-all)"; break;
                                case 'DKIM': if (name.includes('_domainkey')) { hasDkim = true; patternDescription = "Null DKIM Configuration"; } break;
                                case 'DMARC': if (name.startsWith('_dmarc.') || name === '_dmarc') { hasDmarc = true; patternDescription = "Restrictive DMARC Policy"; } break;
                                case 'REGISTRAR':
                                    hasRegistrarMarker = true;
                                    if (txtData.includes('parkingcrew')) patternDescription = "ParkingCrew Parking Service";
                                    else if (txtData.includes('sedoparking')) patternDescription = "Sedo Parking Service";
                                    else if (txtData.includes('domain_control_validation')) patternDescription = "Domain Control Validation";
                                    else patternDescription = "Registrar Parking Marker";
                                    break;
                                case 'PREMIUM':
                                    hasPremiumMarker = true;
                                    if (pattern.toString().includes('premium')) patternDescription = "Premium Domain Marker";
                                    else if (pattern.toString().includes('for[-_]?sale')) patternDescription = "Domain For Sale Marker";
                                    else if (pattern.toString().includes('inquire')) patternDescription = "Domain Purchase Inquiry";
                                    else if (pattern.toString().includes('domainbroker')) patternDescription = "Domain Broker Reference";
                                    else if (pattern.toString().includes('reserve')) patternDescription = "Reserved Domain";
                                    else patternDescription = "Generic Premium Domain Marker";
                                    break;
                                case 'ACTIVE_USAGE':
                                    hasVerificationTxt = true;
                                    if (pattern.toString().includes('google-site-verification')) patternDescription = "Google Site Verification";
                                    else if (pattern.toString().includes('ms=ms')) patternDescription = "Microsoft Verification";
                                    else if (pattern.toString().includes('facebook')) patternDescription = "Facebook Domain Verification";
                                    else if (pattern.toString().includes('apple')) patternDescription = "Apple Domain Verification";
                                    else if (pattern.toString().includes('docusign')) patternDescription = "DocuSign Verification";
                                    else if (pattern.toString().includes('stripe')) patternDescription = "Stripe Verification";
                                    else patternDescription = "Service Verification TXT";
                                    break;
                            }
                            if (patternDescription) patternsFound.add(patternDescription);
                        }
                    } catch (e) {
                        console.error(`Regex error testing pattern ${pattern} on data: ${txtData}`, e);
                    }
                });
            };

            if (name.startsWith('*.') || name.includes('.*')) {
                if (!patternsFound.has("Wildcard DNS Protection")) {
                    hasWildcard = true;
                    patternsFound.add("Wildcard DNS Protection");
                }
            }

            testPattern(PARKING_PATTERNS.SPF, 'SPF');
            testPattern(PARKING_PATTERNS.DKIM, 'DKIM');
            testPattern(PARKING_PATTERNS.DMARC, 'DMARC');
            testPattern(PARKING_PATTERNS.REGISTRAR, 'REGISTRAR');
            testPattern(PARKING_PATTERNS.PREMIUM, 'PREMIUM');
            testPattern(PARKING_PATTERNS.ACTIVE_USAGE, 'ACTIVE_USAGE');
        }
    });

    let confidence = 0;
    if (hasSpf) confidence += 25;
    if (hasDkim) confidence += 20;
    if (hasDmarc) confidence += 15;
    if (hasWildcard) confidence += 15;
    if (hasRegistrarMarker) confidence += 30;
    confidence = Math.min(confidence, 100);

    const isParked = confidence >= 40;
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

// Check Wildcard DNS
export const checkWildcardDNS = async (domain: string, providerUrl: string): Promise<boolean> => {
    const randomSubdomain = `check-${Math.random().toString(36).substring(2, 10)}-${Date.now().toString(36)}`
    const wildcardTestDomain = `${randomSubdomain}.${domain}`

    const providerConfig = getProviderConfigFromUrl(providerUrl)
    const providerName = providerConfig?.name ?? 'Unknown Provider'

    try {
      const data = await fetchDnsJson(providerUrl, wildcardTestDomain, DNS_RECORD_TYPE_A)
      const hasResolvingAnswer = data.Answer?.some(r => [DNS_RECORD_TYPE_A, 5 /* CNAME */, 28 /* AAAA */].includes(r.type)) ?? false;
      const isWildcardDetected = data.Status === DNS_STATUS_NOERROR && hasResolvingAnswer;

      if (isWildcardDetected) {
        console.info(`[Domain Check Logic] Wildcard detected for ${domain} via ${providerName} using ${wildcardTestDomain}`)
      } else {
         console.info(`[Domain Check Logic] No wildcard detected for ${domain} via ${providerName} using ${wildcardTestDomain} (Status: ${data.Status}, Answers: ${data.Answer?.length ?? 0})`)
      }
      return isWildcardDetected

    } catch (error) {
      const { message } = handleError(`Wildcard Check (${providerName})`, error as Error, domain)
      console.warn(`[Domain Check Logic] Wildcard check failed for ${domain} via ${providerName}: ${message}. Proceeding as non-wildcard.`)
      throw error // Re-throw so the caller knows the check failed
    }
}

// Interpret Combined Results
export const interpretCombinedResults = (
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
    let noErrorWithRecordsCount = 0
    let noErrorWithoutRecordsCount = 0
    let servFailCount = 0
    let otherDnsErrorCount = 0
    let networkOrTimeoutErrorCount = 0
    let dnssecValidated = false
    let parkedNsCount = 0
    const txtAnalysisResults = new Map<string, ReturnType<typeof analyzeTxtRecordsForParking>>()
    let primaryErrorCategory: ErrorCategory | undefined = undefined
    let primaryErrorMessage: string | undefined = undefined
    let hasActiveUsageIndicators = false

    const processedProviders = new Set<string>()
    const nsResponses = new Map<string, string[]>()
    const primaryProviderNames = PRIMARY_PROVIDER_URLS.map(url => {
        const config = getProviderConfigFromUrl(url);
        return config?.name ?? 'Unknown';
    });

    const primaryProviderResults = providerResults.filter(r => primaryProviderNames.includes(r.provider));

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

                if (result.queryType === DNS_RECORD_TYPE_NS && data.Answer) {
                    const currentNsList: string[] = []
                    let providerReportsParkedNs = false;
                    data.Answer.forEach(record => {
                        if (record.type === DNS_RECORD_TYPE_NS && typeof record.data === 'string') {
                             const nameserver = record.data.toLowerCase().replace(/\.$/, '');
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

                if (result.queryType === DNS_RECORD_TYPE_TXT) {
                     const analysis = analyzeTxtRecordsForParking(data);
                     txtAnalysisResults.set(result.provider, analysis);
                     if (analysis.matchedPatterns.length > 0) {
                          reasons.push(` -> Found patterns: [${analysis.matchedPatterns.join(', ')}] (Confidence: ${analysis.confidence})`);
                     }
                     if (analysis.hasActiveUsageIndicators) {
                         hasActiveUsageIndicators = true;
                         reasons.push(` -> Found active domain usage indicators (verifications)`);
                     }
                }

            } else if (data.Status === DNS_STATUS_SERVFAIL) {
                servFailCount++
                 if (!primaryErrorCategory) {
                    primaryErrorCategory = ErrorCategory.DNS_ERROR
                    primaryErrorMessage = `DNS server failure (SERVFAIL) reported by ${result.provider}`
                }
            } else {
                 otherDnsErrorCount++
                 reasons.push(` -> DNS error code ${data.Status}.`)
                 if (!primaryErrorCategory) {
                    primaryErrorCategory = ErrorCategory.DNS_ERROR
                    primaryErrorMessage = `DNS error ${DNS_STATUS_MESSAGES[data.Status]} reported by ${result.provider}`
                }
            }

            if (data.AD) {
                dnssecValidated = true
                reasons.push(` -> DNSSEC validated (AD flag).`)
            }
        } else { // status === 'rejected'
            const category = result.errorCategory || ErrorCategory.UNKNOWN
            const message = result.errorMessage || 'Unknown error'
             reasons.push(`Provider ${result.provider}${isPrimaryProvider ? ' (Primary)' : ''} (${queryTypeText}): Error - ${message}`)

            if (category === ErrorCategory.NETWORK || category === ErrorCategory.TIMEOUT) {
                networkOrTimeoutErrorCount++
            } else {
                otherDnsErrorCount++
            }

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
    const distinctProviderResponses = processedProviders.size
    const consensusThreshold = Math.max(1, Math.ceil(distinctProviderResponses / 2));

    const primaryProviderCount = primaryProviderNames.length;
    const primaryProviderResponses = primaryProviderResults.length;
    const primaryNxDomainCount = primaryProviderResults.filter(r =>
      r.status === 'fulfilled' && r.value.Status === DNS_STATUS_NXDOMAIN
    ).length;
    const primaryNoErrorWithRecordsCount = primaryProviderResults.filter(r =>
      r.status === 'fulfilled' &&
      r.value.Status === DNS_STATUS_NOERROR &&
      (r.value.Answer?.some(rec => rec.type === DNS_RECORD_TYPE_NS || rec.type === DNS_RECORD_TYPE_SOA) ||
       r.value.Authority?.some(rec => rec.type === DNS_RECORD_TYPE_NS || rec.type === DNS_RECORD_TYPE_SOA))
    ).length;
    const primaryNxDomainConsensus = primaryNxDomainCount === primaryProviderCount && primaryProviderCount > 1;
    const anyPrimaryNoErrorWithRecords = primaryNoErrorWithRecordsCount > 0;

    let parkedTxtConsensusCount = 0;
    let uniqueMatchedTxtPatterns = new Set<string>();
    txtAnalysisResults.forEach(analysis => {
        if (analysis.isParked) parkedTxtConsensusCount++;
        analysis.matchedPatterns.forEach(p => uniqueMatchedTxtPatterns.add(p));
    });

    let premiumTxtConsensusCount = 0;
    let uniquePremiumTxtPatterns = new Set<string>();
    txtAnalysisResults.forEach(analysis => {
        if (analysis.isPremium) {
            premiumTxtConsensusCount++;
            analysis.matchedPatterns.filter(p =>
                p.toLowerCase().includes('premium') ||
                p.toLowerCase().includes('sale') ||
                p.toLowerCase().includes('broker')
            ).forEach(p => uniquePremiumTxtPatterns.add(p));
        }
    });

    const hasPremiumTxtSignalConsensus = premiumTxtConsensusCount >= consensusThreshold && premiumTxtConsensusCount > 0;
    const hasStrongParkingSignal =
      parkedNsCount >= consensusThreshold ||
      parkedTxtConsensusCount >= consensusThreshold ||
      (isWildcard && (parkedNsCount > 0 || parkedTxtConsensusCount > 0));

    if (hasActiveUsageIndicators) {
        finalStatus = DomainAvailabilityStatus.REGISTERED;
        reasons.push("High Confidence: Found active usage indicators (verification TXT records), domain is in use.");
        if (noErrorWithRecordsCount > 0) reasons.push("-> Also confirmed by NS/SOA records.");
        if (hasStrongParkingSignal) reasons.push(`-> Domain also shows parking signals (NS: ${parkedNsCount}, TXT Park: ${parkedTxtConsensusCount}, Wildcard: ${isWildcard}).`);
    }
    else if (noErrorWithRecordsCount > 0) {
        finalStatus = DomainAvailabilityStatus.REGISTERED;
        reasons.push("High Confidence: Found authoritative NS/SOA records, indicating the domain is registered.");
        if (hasStrongParkingSignal) {
            reasons.push(`-> Domain appears potentially parked/premium based on NS/TXT signals. (NS: ${parkedNsCount}, TXT Park: ${parkedTxtConsensusCount}, TXT Premium: ${premiumTxtConsensusCount}, Wildcard: ${isWildcard}). Matched Premium TXT: [${Array.from(uniquePremiumTxtPatterns).join(', ')}]`);
        } else if (hasPremiumTxtSignalConsensus) {
             reasons.push(`-> Premium TXT patterns detected by consensus, potentially indicating a premium domain for sale. Matched TXT: [${Array.from(uniquePremiumTxtPatterns).join(', ')}]`);
        }
    }
    else if (nxDomainCount > 0 && noErrorWithRecordsCount === 0 && servFailCount === 0) {
         if (!isWildcard && nxDomainCount >= distinctProviderResponses) {
            finalStatus = DomainAvailabilityStatus.AVAILABLE;
            reasons.push("High Confidence: All responding providers reported NXDOMAIN (Not Found) without conflicting signals.");
             if (hasPremiumTxtSignalConsensus) {
                 reasons.push(`-> Warning: Domain appears available (NXDOMAIN), but conflicting Premium TXT patterns were detected. Status uncertain. Matched TXT: [${Array.from(uniquePremiumTxtPatterns).join(', ')}]`);
                 finalStatus = DomainAvailabilityStatus.INDETERMINATE;
             }
        } else if (!isWildcard && nxDomainCount > 0 && (nxDomainCount + networkOrTimeoutErrorCount + otherDnsErrorCount) >= distinctProviderResponses) {
             finalStatus = DomainAvailabilityStatus.AVAILABLE;
             reasons.push("Moderate Confidence: At least one provider reported NXDOMAIN with no conflicting registration signals.");
              if (hasPremiumTxtSignalConsensus) {
                 reasons.push(`-> Warning: Domain appears available (NXDOMAIN), but conflicting Premium TXT patterns were detected. Status uncertain. Matched TXT: [${Array.from(uniquePremiumTxtPatterns).join(', ')}]`);
                 finalStatus = DomainAvailabilityStatus.INDETERMINATE;
             }
        } else if (isWildcard) {
            if (hasStrongParkingSignal || hasPremiumTxtSignalConsensus) {
                 finalStatus = DomainAvailabilityStatus.REGISTERED;
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
    else if (hasPremiumTxtSignalConsensus && noErrorWithRecordsCount === 0 && nxDomainCount === 0 ) {
         finalStatus = DomainAvailabilityStatus.PREMIUM;
         reasons.push(`Moderate Confidence: Premium status inferred primarily from consensus on specific TXT records indicating domain is for sale/premium. Matched TXT: [${Array.from(uniquePremiumTxtPatterns).join(', ')}]`);
          if (hasStrongParkingSignal && !reasons[reasons.length-1].includes("Parking signals")) {
             reasons.push(`-> Parking signals also detected (NS: ${parkedNsCount}, TXT Park: ${parkedTxtConsensusCount}, Wildcard: ${isWildcard}), supporting premium/reserved classification.`);
         }
    }
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
    else if (noErrorWithoutRecordsCount > 0) {
        finalStatus = DomainAvailabilityStatus.INDETERMINATE;
        reasons.push("Low Confidence: Received NOERROR status but without confirming NS/SOA records. Status uncertain.");
         if (isWildcard) reasons.push("-> Wildcard DNS detected, adding to uncertainty.");
    }
    else if ((networkOrTimeoutErrorCount + otherDnsErrorCount) === totalResponses && totalResponses > 0) {
        finalStatus = DomainAvailabilityStatus.ERROR;
        reasons.push("Error: Failed to get conclusive DNS status due to network issues or server errors.");
    } else {
        finalStatus = DomainAvailabilityStatus.INDETERMINATE;
         reasons.push("Indeterminate: Could not determine a confident status based on mixed or inconclusive results.");
        if ((networkOrTimeoutErrorCount + otherDnsErrorCount + servFailCount) === totalResponses && totalResponses > 0) {
             finalStatus = DomainAvailabilityStatus.ERROR;
        }
    }

    // Generate the link within this module now
    const link = generateLink(domain, finalStatus);

    return {
        domain,
        status: finalStatus,
        error: finalStatus === DomainAvailabilityStatus.ERROR,
        errorCategory: finalStatus === DomainAvailabilityStatus.ERROR ? primaryErrorCategory : undefined,
        errorMessage: finalStatus === DomainAvailabilityStatus.ERROR ? primaryErrorMessage : undefined,
        link: link,
        confidenceReasons: reasons,
        dnssecValidated,
        wildcardDetected: isWildcard || isKnownWildcardTld,
        isParkedByNs: parkedNsCount >= consensusThreshold,
        isParkedByTxt: parkedTxtConsensusCount >= consensusThreshold
    }
}

// Generate Link
export const generateLink = (domain: string, status: DomainAvailabilityStatus): string => {
    const tld = '.' + domain.split('.').pop()

    let registrarBaseUrl = `https://domainr.com/`

    if (tld && namecheapTLDs.includes(tld)) {
      registrarBaseUrl = `https://www.namecheap.com/domains/registration/results/?domain=`
    }

    switch (status) {
      case DomainAvailabilityStatus.REGISTERED:
        return domain.startsWith('http') ? domain : `http://${domain}`
      case DomainAvailabilityStatus.PREMIUM:
        if (tld && namecheapTLDs.includes(tld)) {
            return `${registrarBaseUrl}${domain}`
        }
        return `https://dan.com/buy-domain/${domain}`
      case DomainAvailabilityStatus.AVAILABLE:
        return `${registrarBaseUrl}${domain}`
      case DomainAvailabilityStatus.INDETERMINATE:
      case DomainAvailabilityStatus.ERROR:
      default:
        return `https://domainr.com/${domain}`
    }
}


// Check Domain Availability (Main Logic Function)
export const checkDomainAvailability = async (domain: string, wildcardCheckProviderUrl: string): Promise<DomainResult> => {
    if (PRIMARY_PROVIDER_URLS.length === 0) {
      throw new Error("No primary DoH providers configured.");
    }

    const tld = domain.substring(domain.indexOf('.'));
    const isKnownWildcardTld = KNOWN_WILDCARD_TLDS.has(tld);

    let isWildcard = false;
    let wildcardCheckError: string | undefined = undefined;
    const initialConfidenceReasons: string[] = [];

    if (isKnownWildcardTld) {
      initialConfidenceReasons.push(`Domain uses TLD (${tld}) known to commonly implement wildcards.`);
    }

    // 1. Wildcard Check (using the passed provider URL)
    try {
      // Pass the specific provider URL for this check
      isWildcard = await checkWildcardDNS(domain, wildcardCheckProviderUrl);
      if (isWildcard) {
        initialConfidenceReasons.push('Wildcard DNS detected (often used for parking/catch-alls).');
      }
    } catch (error) {
      const { message } = handleError('Wildcard check', error as Error, domain);
      wildcardCheckError = `Wildcard detection failed: ${message}`;
      initialConfidenceReasons.push(wildcardCheckError);
    }

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
          const { category, message } = handleError(`TXT query from ${providerName}`, error as Error, domain);
          return { status: 'rejected' as const, reason: error as Error, provider: providerName, queryType: DNS_RECORD_TYPE_TXT, errorCategory: category, errorMessage: message, suggestsDomainExists: false };
        });

      return [nsPromise, txtPromise];
    });

    const nsTxtResults = await Promise.all(queryPromises);
    allProviderResults.push(...nsTxtResults);

    // 3. Fallback to SOA if NS queries were inconclusive
    const nsResultsOnly = allProviderResults.filter(r => r.queryType === DNS_RECORD_TYPE_NS);
    const needSoaFallback = nsResultsOnly.every(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value.Status !== DNS_STATUS_NOERROR && r.value.Status !== DNS_STATUS_NXDOMAIN));

    if (needSoaFallback) {
      console.info(`[Domain Check Logic] NS/TXT queries inconclusive for ${domain}, trying SOA records.`);
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
      allProviderResults.push(...soaResults);
    }

    // 4. Interpret combined results
    return interpretCombinedResults(domain, allProviderResults, isWildcard, isKnownWildcardTld, errorsIndicatingDomainExists, initialConfidenceReasons);
}

// Type definitions that were moved (can be used by both worker and main thread)
// CheckStage might be needed if ProgressState is used across modules
export enum CheckStage {
  PREPARING = 'preparing',
  WILDCARD_CHECK = 'wildcard_check',
  PRIMARY_QUERY = 'primary_query',
  FALLBACK_QUERY = 'fallback_query',
  ANALYZING = 'analyzing',
  FINALIZING = 'finalizing',
  COMPLETE = 'complete'
}

export interface ProgressState {
  percentage: number,
  currentDomain?: string,
  stage: CheckStage,
  domainsProcessed: number,
  totalDomains: number,
  detailedMessage?: string,
  providers?: Array<{ url: string, name?: string, active: boolean }>,
  errors?: string[]
}

// Interface extending DnsResponse (if any custom fields were added)
// Example:
// export interface DoHJsonResponse extends DnsResponse {
//   // Custom fields if any
// } 