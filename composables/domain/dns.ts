import type { DnsResponse } from '~/utils/DohResolver'
import { DohResolver } from '~/utils/DohResolver'
import { 
  TIMEOUT_MS, 
  MAX_RETRIES, 
  getProviderConfigFromUrl 
} from '~/config/appConfig'
import { 
  DNS_STATUS_MESSAGES, 
  DNS_RECORD_TYPE_A,
  DNS_RECORD_TYPE_NS,
  DNS_RECORD_TYPE_SOA,
  DNS_RECORD_TYPE_TXT,
  DNS_STATUS_NOERROR,
  DOMAIN_CHECK_ERRORS_SUGGESTING_DOMAIN_EXISTS
} from './constants'
import { ErrorCategory, type DoHJsonResponse } from './types'

// We need to define this type here since it's not exported from DohResolver
export interface DohProvider {
  name: string;
  baseUrl: string;
  headers?: Record<string, string>;
}

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

    return { category, message, suggestsDomainExists }
  }

// DNS Fetching Logic
export const fetchDnsJson = async (
  provider: DohProvider,
  domain: string, 
  recordType: number,
  signal?: AbortSignal
): Promise<DoHJsonResponse> => {
    let attempts = 0;
    let lastError: Error | null = null;

    while (attempts <= MAX_RETRIES) {
      try {
        const resolver = new DohResolver(provider.baseUrl);

        let recordTypeStr: string;
        switch (recordType) {
          case DNS_RECORD_TYPE_NS: recordTypeStr = 'NS'; break;
          case DNS_RECORD_TYPE_SOA: recordTypeStr = 'SOA'; break;
          case DNS_RECORD_TYPE_TXT: recordTypeStr = 'TXT'; break;
          case DNS_RECORD_TYPE_A: recordTypeStr = 'A'; break;
          default: recordTypeStr = recordType.toString();
        }

        // Pass signal to the resolver
        const data = await resolver.query(
          domain,
          recordType,
          'GET',
          provider.headers,
          TIMEOUT_MS,
          signal
        ) as DoHJsonResponse;

        if (DOMAIN_CHECK_ERRORS_SUGGESTING_DOMAIN_EXISTS.includes(data.Status)) {
          const errorMessage = DNS_STATUS_MESSAGES[data.Status] || `Unknown error code ${data.Status}`
          console.warn(`[DNS] Domain check for ${domain} (record type ${recordType}) received error code ${data.Status}: ${errorMessage}`)
        }

        return data;
      } catch (rawError) {
        const error = rawError instanceof Error ? rawError : new Error(String(rawError));
        lastError = error;
        attempts++;

        // Handle explicit abort signal
        if (signal?.aborted) {
          throw new Error('Operation cancelled by user');
        }

        const isTimeout = error instanceof DOMException && error.name === 'AbortError' ||
                          error.message.toLowerCase().includes('timeout');
        const isTransientServerError = error.message.includes('status') &&
                                       /status (50[234])/.test(error.message);

        if ((isTimeout || isTransientServerError) && attempts <= MAX_RETRIES) {
          console.warn(`[Domain Check Logic] Retrying query for ${domain} (${recordType}) with ${provider.name} (Attempt ${attempts}/${MAX_RETRIES}) after error: ${error.message}`);
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

// Check Wildcard DNS
export const checkWildcardDNS = async (domain: string, provider: DohProvider): Promise<boolean> => {
    const randomSubdomain = `check-${Math.random().toString(36).substring(2, 10)}-${Date.now().toString(36)}`
    const wildcardTestDomain = `${randomSubdomain}.${domain}`

    const providerName = provider.name ?? 'Unknown Provider'

    try {
      const data = await fetchDnsJson(provider, wildcardTestDomain, DNS_RECORD_TYPE_A)
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