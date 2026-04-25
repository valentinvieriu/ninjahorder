import type { DnsResponse } from '~/utils/DohResolver'
import { DohResolver } from '~/utils/DohResolver'
import { 
  TIMEOUT_MS, 
  MAX_RETRIES, 
  INITIAL_RETRY_DELAY_MS,
  MAX_RETRY_DELAY_MS
} from '~/config/appConfig'
import {
  DNS_STATUS_MESSAGES,
  DNS_RECORD_TYPE_A,
  DNS_RECORD_TYPE_AAAA,
  DNS_RECORD_TYPE_CNAME,
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

export interface FetchDnsJsonOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
  initialRetryDelayMs?: number;
  maxRetryDelayMs?: number;
}

interface ResolvedFetchDnsJsonOptions {
  signal?: AbortSignal;
  timeoutMs: number;
  maxRetries: number;
  initialRetryDelayMs: number;
  maxRetryDelayMs: number;
}

const resolveFetchOptions = (signalOrOptions?: AbortSignal | FetchDnsJsonOptions): ResolvedFetchDnsJsonOptions => {
  if (signalOrOptions && 'aborted' in signalOrOptions) {
    return {
      signal: signalOrOptions,
      timeoutMs: TIMEOUT_MS,
      maxRetries: MAX_RETRIES,
      initialRetryDelayMs: INITIAL_RETRY_DELAY_MS,
      maxRetryDelayMs: MAX_RETRY_DELAY_MS,
    }
  }

  return {
    signal: signalOrOptions?.signal,
    timeoutMs: signalOrOptions?.timeoutMs ?? TIMEOUT_MS,
    maxRetries: signalOrOptions?.maxRetries ?? MAX_RETRIES,
    initialRetryDelayMs: signalOrOptions?.initialRetryDelayMs ?? INITIAL_RETRY_DELAY_MS,
    maxRetryDelayMs: signalOrOptions?.maxRetryDelayMs ?? MAX_RETRY_DELAY_MS,
  }
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
    const lowerMessage = error.message.toLowerCase()
    if (error.name === 'AbortError' || lowerMessage.includes('timeout') || lowerMessage.includes('timed out')) {
      category = ErrorCategory.TIMEOUT
      message = 'DNS request timed out'
      suggestsDomainExists = false
    } else if (error instanceof TypeError && (error.message.includes('NetworkError') || error.message.includes('fetch'))) {
      category = ErrorCategory.NETWORK
      message = 'Network connection issue'
      suggestsDomainExists = false
    } else if (lowerMessage.includes('status') || lowerMessage.includes('http error')) { // Likely an HTTP error from fetch
      category = ErrorCategory.DNS_ERROR
      const statusMatch = error.message.match(/(?:status|http error:)\s*(\d+)/i)
      const httpStatus = statusMatch ? parseInt(statusMatch[1], 10) : null

      if (httpStatus && [500, 502, 503, 504].includes(httpStatus)) {
        message = `DoH provider server error (${httpStatus})`
        suggestsDomainExists = false
      } else if (httpStatus) {
        message = `DoH query failed with HTTP ${httpStatus}`
        suggestsDomainExists = false
      } else {
        message = 'DoH server error (Unknown Status)'
        suggestsDomainExists = false
      }
    } else if (error.message.includes('SERVFAIL') || error.message.includes('Server Failure')) {
      // SERVFAIL is overwhelmingly transient or DNSSEC-validation related, not
      // proof of registration. Treat it as uncertainty, not as existence
      // evidence. The interpretation layer separately tracks SERVFAIL response
      // statuses to dampen availability scoring.
      category = ErrorCategory.DNS_ERROR
      message = 'DNS server failed to process the query (SERVFAIL)'
      suggestsDomainExists = false
    } else if (error.message.includes('REFUSED') || error.message.includes('Query Refused')) {
      // REFUSED means the resolver declined to answer — not evidence of
      // existence either.
      category = ErrorCategory.DNS_ERROR
      message = 'DNS server refused the query (REFUSED)'
      suggestsDomainExists = false
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
  signalOrOptions?: AbortSignal | FetchDnsJsonOptions
): Promise<DoHJsonResponse> => {
    let attempts = 0;
    let lastError: Error | null = null;
    const {
      signal,
      timeoutMs,
      maxRetries,
      initialRetryDelayMs,
      maxRetryDelayMs,
    } = resolveFetchOptions(signalOrOptions);
    
    // Convert record type to string for logging
    let recordTypeStr: string;
    switch (recordType) {
      case DNS_RECORD_TYPE_NS: recordTypeStr = 'NS'; break;
      case DNS_RECORD_TYPE_SOA: recordTypeStr = 'SOA'; break;
      case DNS_RECORD_TYPE_TXT: recordTypeStr = 'TXT'; break;
      case DNS_RECORD_TYPE_A: recordTypeStr = 'A'; break;
      default: recordTypeStr = recordType.toString();
    }

    while (attempts <= maxRetries) {
      try {
        const resolver = new DohResolver(provider.baseUrl);

        // Pass signal to the resolver
        const data = await resolver.query(
          domain,
          recordType,
          'GET',
          provider.headers,
          timeoutMs,
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

        // Handle explicit abort signal - Non-retryable
        if (signal?.aborted) {
          throw new Error('Operation cancelled by user');
        }

        // Use refined error handling to categorize the error
        const { category, message, suggestsDomainExists } = handleError(
          `DNS Query (${provider.name})`,
          error,
          domain
        );

        // Extract HTTP status (if any) without depending on the literal substring "status"
        const httpStatusMatch = error.message.match(/(?:status|http error:?)\s*(\d{3})/i);
        const httpStatus = httpStatusMatch ? parseInt(httpStatusMatch[1], 10) : null;
        const isTransientHttp = httpStatus !== null && (httpStatus === 429 || (httpStatus >= 500 && httpStatus <= 504));

        // Determine if error is retryable. Notably we do NOT retry on SERVFAIL/REFUSED
        // rcodes — those usually indicate authoritative-side issues that won't change
        // within a few hundred ms.
        const isRetryable = (
          category === ErrorCategory.TIMEOUT ||
          category === ErrorCategory.NETWORK ||
          (category === ErrorCategory.DNS_ERROR && isTransientHttp)
        ) && attempts <= maxRetries;

        if (isRetryable) {
          // Implement exponential backoff with jitter
          const baseDelay = Math.min(
            initialRetryDelayMs * Math.pow(2, attempts - 1), 
            maxRetryDelayMs
          );
          const jitter = baseDelay * 0.2 * (Math.random() - 0.5); // +/- 10% jitter
          const waitTime = Math.max(0, baseDelay + jitter);

          console.warn(
            `[DNS] Retrying query for ${domain} (${recordTypeStr}) with ${provider.name} ` +
            `(Attempt ${attempts}/${maxRetries}) after ${category} error. ` +
            `Waiting ${waitTime.toFixed(0)}ms. Error: ${message}`
          );
          
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue; // Retry the loop
        } else {
          console.warn(
            `[DNS] Non-retryable error for ${domain} (${recordTypeStr}) with ${provider.name} ` +
            `after ${attempts} attempt(s): ${message}`
          );
          break; // Exit retry loop
        }
      }
    }

    if (lastError) {
      throw lastError;
    } else {
      throw new Error('Unknown error during DNS fetch');
    }
}

// Check Wildcard DNS
//
// Probes a random subdomain for A AND AAAA records. A wildcard zone serving
// only AAAA or only CNAME would otherwise slip past an A-only probe and a
// wildcard-but-unregistered-looking name could incorrectly read as available.
// We use two distinct random labels and require both A and AAAA queries on
// each to see the wildcard before we trust the negative answer.
const RESOLVING_RECORD_TYPES = [DNS_RECORD_TYPE_A, DNS_RECORD_TYPE_AAAA, DNS_RECORD_TYPE_CNAME]

const generateRandomLabel = (): string =>
  `check-${Math.random().toString(36).substring(2, 10)}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`

export const checkWildcardDNS = async (
  domain: string,
  provider: DohProvider,
  options?: FetchDnsJsonOptions
): Promise<boolean> => {
    const providerName = provider.name ?? 'Unknown Provider'
    const probes = [
      { label: generateRandomLabel(), recordType: DNS_RECORD_TYPE_A },
      { label: generateRandomLabel(), recordType: DNS_RECORD_TYPE_AAAA },
    ]

    // Use allSettled so a sibling probe failure (e.g., one type times out)
    // cannot wipe out a positive wildcard signal from the other probe. We
    // still re-throw when no probe was positive AND at least one failed, so
    // the caller can correctly decrement confidence on a fully-failed check.
    const probeOutcomes = await Promise.allSettled(probes.map(async probe => {
      const probeDomain = `${probe.label}.${domain}`
      const data = await fetchDnsJson(provider, probeDomain, probe.recordType, options)
      const hasResolvingAnswer = data.Answer?.some(r => RESOLVING_RECORD_TYPES.includes(r.type)) ?? false
      return {
        probeDomain,
        recordType: probe.recordType,
        isWildcard: data.Status === DNS_STATUS_NOERROR && hasResolvingAnswer,
        status: data.Status,
        answerCount: data.Answer?.length ?? 0,
      }
    }))

    const fulfilled = probeOutcomes
      .filter((o): o is PromiseFulfilledResult<{ probeDomain: string; recordType: number; isWildcard: boolean; status: number; answerCount: number }> => o.status === 'fulfilled')
      .map(o => o.value)
    const rejected = probeOutcomes.filter(o => o.status === 'rejected') as PromiseRejectedResult[]

    const isWildcardDetected = fulfilled.some(result => result.isWildcard)

    if (isWildcardDetected) {
      const positives = fulfilled.filter(result => result.isWildcard).map(result => `${result.probeDomain} (type ${result.recordType})`)
      console.info(`[Domain Check Logic] Wildcard detected for ${domain} via ${providerName}: ${positives.join(', ')}`)
      return true
    }

    if (fulfilled.length > 0) {
      const summary = fulfilled.map(result => `${result.probeDomain} status=${result.status} answers=${result.answerCount}`).join('; ')
      console.info(`[Domain Check Logic] No wildcard detected for ${domain} via ${providerName} (${summary})`)
      return false
    }

    // No probe succeeded — surface the failure so the caller can mark this
    // provider's wildcard probe as failed.
    const firstRejection = rejected[0]?.reason instanceof Error
      ? rejected[0].reason
      : new Error(String(rejected[0]?.reason ?? 'Unknown wildcard probe error'))
    const { message } = handleError(`Wildcard Check (${providerName})`, firstRejection, domain)
    console.warn(`[Domain Check Logic] Wildcard check failed for ${domain} via ${providerName}: ${message}. Proceeding as non-wildcard.`)
    throw firstRejection
}
