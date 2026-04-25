import { type DnsResponse } from '~/utils/DohResolver'
import {
    CONFIRMATION_TIMEOUT_MS,
    DNS_QUERY_RETRIES,
    DNS_QUERY_TIMEOUT_MS,
    KNOWN_WILDCARD_TLDS
} from '~/config/appConfig'
import { 
  DNS_RECORD_TYPE_NS, 
  DNS_RECORD_TYPE_SOA, 
  DNS_RECORD_TYPE_TXT,
  DNS_STATUS_NOERROR,
  DNS_STATUS_NXDOMAIN,
  DNS_STATUS_REFUSED,
  DNS_STATUS_SERVFAIL,
} from './constants'
import { 
  handleError, 
  fetchDnsJson, 
  checkWildcardDNS,
  type DohProvider
} from './dns'
import { 
  hasExactAnswer,
  interpretCombinedResults
} from './analysis/interpretation'
import { generateLink } from './utils'
import { 
  type DomainResult,
  CheckStage,
  type ProgressState,
  ErrorCategory,
  DomainAvailabilityStatus
} from './types'

/**
 * Performs a confirmation check for domains initially flagged as available
 * Uses different query approach to validate the initial finding
 */
type ProviderQueryResult =
    { status: 'fulfilled', value: DnsResponse, provider: string, queryType: number } |
    { status: 'rejected', reason: Error, provider: string, queryType: number, errorCategory?: ErrorCategory, errorMessage?: string, suggestsDomainExists?: boolean }

async function performConfirmationCheck(
    domain: string,
    providers: DohProvider[],
    abortSignal?: AbortSignal
): Promise<ProviderQueryResult[]> {
    // Confirm against every configured provider. This only runs for promising
    // candidates, so the extra requests buy useful precision without slowing
    // down obviously registered domains.
    const confirmationProviders = providers;
    const queryPromises: Promise<any>[] = [];
    
    // Focus on SOA records for confirmation as they're definitive
    confirmationProviders.forEach(provider => {
        queryPromises.push(
            fetchDnsJson(provider, domain, DNS_RECORD_TYPE_SOA, {
                signal: abortSignal,
                timeoutMs: CONFIRMATION_TIMEOUT_MS,
                maxRetries: 0
            })
                .then(value => ({ status: 'fulfilled' as const, value, provider: provider.name, queryType: DNS_RECORD_TYPE_SOA }))
                .catch(error => {
                    const { category, message, suggestsDomainExists } = handleError(
                        `Confirmation SOA query from ${provider.name}`,
                        error instanceof Error ? error : new Error(String(error)),
                        domain
                    )
                    
                    return {
                        status: 'rejected' as const,
                        reason: error instanceof Error ? error : new Error(String(error)),
                        provider: provider.name,
                        queryType: DNS_RECORD_TYPE_SOA,
                        errorCategory: category,
                        errorMessage: message,
                        suggestsDomainExists
                    }
                })
        )
    });
    
    // Wait for all confirmation queries to complete
    const results = await Promise.allSettled(queryPromises);
    return results.map(result => {
        if (result.status === 'fulfilled') {
            return result.value;
        } else {
            // This should never happen with our Promise.allSettled approach
            return {
                status: 'rejected' as const,
                reason: new Error('Unknown error in confirmation check Promise.allSettled'),
                provider: 'unknown',
                queryType: DNS_RECORD_TYPE_SOA,
                errorCategory: ErrorCategory.UNKNOWN,
                errorMessage: 'Unknown error in confirmation check Promise.allSettled'
            }
        }
    });
}

/**
 * Main function to check domain availability
 * 
 * @param domain The domain to check
 * @param providers List of DNS over HTTPS providers to use
 * @param abortSignal Optional signal to abort the request
 * @param updateProgress Optional callback to update progress
 * @returns Promise resolving to domain availability result
 */
export default async function checkDomainAvailability(
    domain: string,
    providers: DohProvider[],
    abortSignal?: AbortSignal,
    updateProgress?: (state: ProgressState) => void
): Promise<DomainResult> {
    const startTime = performance.now()
    domain = domain.toLowerCase()
    const confidenceReasons: string[] = []
    if (providers.length === 0) {
        throw new Error('No DNS providers configured')
    }
    
    // Extract TLD from domain for wildcard checks
    const domainSplit = domain.split('.')
    const tld = domainSplit.length > 1 ? domainSplit[domainSplit.length - 1] : null
    const isKnownWildcardTld = tld ? (KNOWN_WILDCARD_TLDS.has(tld) || KNOWN_WILDCARD_TLDS.has(`.${tld}`)) : false
    
    if (isKnownWildcardTld) {
        confidenceReasons.push(`Note: TLD .${tld} is known to use wildcard DNS responses.`)
    }
    
    // Progress tracking
    const updateProgressState = (stage: CheckStage, percentage: number, detailedMessage?: string) => {
        if (updateProgress) {
            updateProgress({
                percentage,
                stage,
                domainsProcessed: 0, // These will be overridden by caller if part of a batch
                totalDomains: 1,     // These will be overridden by caller if part of a batch
                detailedMessage: detailedMessage || `Processing ${domain} (${percentage}%)`
            })
        }
    }
    
    try {
        // Check if aborted before we begin
        if (abortSignal?.aborted) {
            throw new Error('Operation aborted before starting')
        }
        
        updateProgressState(CheckStage.WILDCARD_CHECK, 5, `Checking for wildcard DNS on ${domain}...`)
        const standardQueryOptions = {
            signal: abortSignal,
            timeoutMs: DNS_QUERY_TIMEOUT_MS,
            maxRetries: DNS_QUERY_RETRIES
        }
        
        // Check for wildcard DNS with up to two providers. A failed wildcard
        // probe should reduce confidence, not fail the whole domain check.
        const wildcardProviders = providers.slice(0, Math.min(2, providers.length))
        const wildcardResults = await Promise.allSettled(
            wildcardProviders.map(provider => checkWildcardDNS(domain, provider, standardQueryOptions))
        )
        const isWildcard = wildcardResults.some(result => result.status === 'fulfilled' && result.value)
        const failedWildcardChecks = wildcardResults.filter(result => result.status === 'rejected').length
        
        if (isWildcard) {
            confidenceReasons.push(`Wildcard DNS detected with random subdomain checks for ${domain}.`)
        }

        if (failedWildcardChecks > 0) {
            confidenceReasons.push(`${failedWildcardChecks}/${wildcardResults.length} wildcard DNS probe(s) failed; continuing with lower confidence.`)
        }
        
        // Check if aborted after wildcard check
        if (abortSignal?.aborted) {
            throw new Error('Operation aborted after wildcard check')
        }
        
        updateProgressState(CheckStage.PRIMARY_QUERY, 25, `Performing primary DNS queries for ${domain}...`)
        
        // Track errors that suggest domain might exist
        let totalErrorsSuggestingDomainExists = 0
        
        // Run core DNS queries across all providers. TXT checks are deferred
        // until positive DNS evidence exists, so availability candidates do not
        // get stuck behind unnecessary provider calls.
        const primaryProviderNames = providers.slice(0, 1).map(p => p.name)
        const queryProvider = (
            provider: DohProvider,
            queryType: number,
            recordTypeLabel: string,
            suggestiveErrorWeight: number
        ): Promise<ProviderQueryResult> => {
            return fetchDnsJson(provider, domain, queryType, standardQueryOptions)
                .then(value => ({ status: 'fulfilled' as const, value, provider: provider.name, queryType }))
                .catch(error => {
                    const { category, message, suggestsDomainExists } = handleError(
                        `${recordTypeLabel} query from ${provider.name}`,
                        error instanceof Error ? error : new Error(String(error)),
                        domain
                    )

                    if (suggestsDomainExists) {
                        totalErrorsSuggestingDomainExists += suggestiveErrorWeight
                    }

                    return {
                        status: 'rejected' as const,
                        reason: error instanceof Error ? error : new Error(String(error)),
                        provider: provider.name,
                        queryType,
                        errorCategory: category,
                        errorMessage: message,
                        suggestsDomainExists
                    }
                })
        }

        const primaryQueryPromises: Promise<ProviderQueryResult>[] = []

        providers.forEach(provider => {
            const isPrimaryProvider = primaryProviderNames.includes(provider.name)
            
            // Query for NS records
            primaryQueryPromises.push(
                queryProvider(provider, DNS_RECORD_TYPE_NS, 'NS', isPrimaryProvider ? 2 : 1)
            )
            
            // Only query SOA for primary provider (to reduce load)
            if (isPrimaryProvider) {
                primaryQueryPromises.push(
                    queryProvider(provider, DNS_RECORD_TYPE_SOA, 'SOA', 2)
                )
            }
        })
        
        // Check if aborted before analyzing
        if (abortSignal?.aborted) {
            throw new Error('Operation aborted during DNS queries')
        }
        
        updateProgressState(CheckStage.ANALYZING, 50, `Analyzing DNS query results for ${domain}...`)
        
        // Wait for NS/SOA DNS queries to complete.
        const primaryResults = await Promise.allSettled(primaryQueryPromises)
        const providerResults = primaryResults.map(result => {
            if (result.status === 'fulfilled') {
                return result.value
            } else {
                // This should never happen with our Promise.allSettled approach,
                // but TypeScript requires us to handle this case
                return {
                    status: 'rejected' as const,
                    reason: new Error('Unknown error in Promise.allSettled'),
                    provider: 'unknown',
                    queryType: 0,
                    errorCategory: ErrorCategory.UNKNOWN,
                    errorMessage: 'Unknown error in Promise.allSettled'
                }
            }
        })

        const hasPositiveDnsEvidence = providerResults.some(result =>
            result.status === 'fulfilled' &&
            result.value.Status === DNS_STATUS_NOERROR &&
            hasExactAnswer(result.value, domain, [DNS_RECORD_TYPE_NS, DNS_RECORD_TYPE_SOA])
        )

        if (hasPositiveDnsEvidence) {
            updateProgressState(CheckStage.PRIMARY_QUERY, 45, `Checking TXT signals for ${domain}...`)

            const txtQueryPromises = providers.map(provider => {
                const isPrimaryProvider = primaryProviderNames.includes(provider.name)
                return queryProvider(provider, DNS_RECORD_TYPE_TXT, 'TXT', isPrimaryProvider ? 2 : 1)
            })

            const txtResults = await Promise.allSettled(txtQueryPromises)
            providerResults.push(...txtResults.map(result => {
                if (result.status === 'fulfilled') {
                    return result.value
                }

                return {
                    status: 'rejected' as const,
                    reason: new Error('Unknown error in TXT Promise.allSettled'),
                    provider: 'unknown',
                    queryType: DNS_RECORD_TYPE_TXT,
                    errorCategory: ErrorCategory.UNKNOWN,
                    errorMessage: 'Unknown error in TXT Promise.allSettled'
                }
            }))
        }
        
        // Check if aborted before finalizing
        if (abortSignal?.aborted) {
            throw new Error('Operation aborted during analysis')
        }
        
        updateProgressState(CheckStage.FINALIZING, 75, `Finalizing result for ${domain}...`)
        
        // Interpret combined results
        const domainResult = interpretCombinedResults(
            domain,
            providerResults,
            isWildcard,
            isKnownWildcardTld,
            totalErrorsSuggestingDomainExists,
            confidenceReasons,
            primaryProviderNames
        )
        
        // Add double validation for domains flagged as potentially available
        if (domainResult.status === DomainAvailabilityStatus.PENDING_CONFIRMATION) {
            updateProgressState(CheckStage.CONFIRMATION_QUERY, 85, `Performing confirmation check for ${domain}...`);
            
            try {
                confidenceReasons.push("Performing additional confirmation check for availability.");
                
                // Run a focused confirmation check
                const confirmationResults = await performConfirmationCheck(domain, providers, abortSignal);
                
                const requiredNxDomainConfirmations = Math.max(1, providers.length);
                const nxDomainConfirmations = confirmationResults.filter(result =>
                    result.status === 'fulfilled' &&
                    result.value.Status === DNS_STATUS_NXDOMAIN
                ).length;

                // Exact SOA answers are strong existence evidence. Authority
                // SOA records in negative/NODATA responses are deliberately
                // not treated as existence proof.
                const anyRecordsFound = confirmationResults.some(result =>
                    result.status === 'fulfilled' &&
                    result.value.Status === DNS_STATUS_NOERROR &&
                    hasExactAnswer(result.value, domain, [DNS_RECORD_TYPE_SOA, DNS_RECORD_TYPE_NS])
                );
                
                const anyServfailOrSuggestiveErrors = confirmationResults.some(result =>
                    (result.status === 'fulfilled' && [DNS_STATUS_SERVFAIL, DNS_STATUS_REFUSED].includes(result.value.Status)) ||
                    (result.status === 'rejected' && result.suggestsDomainExists)
                );
                
                if (anyRecordsFound) {
                    confidenceReasons.push("Confirmation check found exact SOA/NS evidence. Marking as registered.");
                    domainResult.status = DomainAvailabilityStatus.REGISTERED;
                } else if (anyServfailOrSuggestiveErrors) {
                    confidenceReasons.push("Confirmation check returned conservative DNS uncertainty. Marking as indeterminate.");
                    domainResult.status = DomainAvailabilityStatus.INDETERMINATE;
                } else if (nxDomainConfirmations >= requiredNxDomainConfirmations) {
                    confidenceReasons.push(`Confirmation check supports availability finding (${nxDomainConfirmations}/${confirmationResults.length} NXDOMAIN confirmations).`);
                    domainResult.status = DomainAvailabilityStatus.AVAILABLE;
                } else {
                    confidenceReasons.push(`Confirmation check did not reach the required independent NXDOMAIN threshold (${nxDomainConfirmations}/${requiredNxDomainConfirmations}). Marking as indeterminate.`);
                    domainResult.status = DomainAvailabilityStatus.INDETERMINATE;
                }
            } catch (confirmError) {
                // If confirmation fails, err on the side of caution
                confidenceReasons.push(`Confirmation check failed: ${confirmError instanceof Error ? confirmError.message : String(confirmError)}. Marking as indeterminate.`);
                domainResult.status = DomainAvailabilityStatus.INDETERMINATE;
            }
        }
        
        // Check if aborted before completing
        if (abortSignal?.aborted) {
            throw new Error('Operation aborted during confirmation check')
        }
        
        // Log check timing and return result
        const endTime = performance.now()
        const duration = endTime - startTime
        
        confidenceReasons.push(`Query completed in ${duration.toFixed(0)}ms with ${providers.length} providers.`)
        
        updateProgressState(CheckStage.COMPLETE, 100, `Check complete for ${domain}`)
        domainResult.link = generateLink(domain, domainResult.status)
        
        return {
            ...domainResult,
            confidenceReasons
        }
    } catch (error) {
        console.error('Error checking domain availability:', error)
        
        // Check if operation was aborted
        if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'))) {
            if (updateProgress) {
                updateProgress({
                    percentage: 0,
                    stage: CheckStage.CANCELLED,
                    domainsProcessed: 0,
                    totalDomains: 1,
                    detailedMessage: `Check for ${domain} was cancelled`
                })
            }
            
            // Rethrow abort errors to be handled by caller
            throw error
        }
        
        if (updateProgress) {
            updateProgress({
                percentage: 100,
                stage: CheckStage.ERROR,
                domainsProcessed: 0,
                totalDomains: 1,
                detailedMessage: error instanceof Error ? error.message : String(error)
            })
        }
        
        const { category, message } = handleError(
          'Domain check', 
          error instanceof Error ? error : new Error(String(error)),
          domain
        )
        
        return {
            domain,
            status: DomainAvailabilityStatus.ERROR,
            error: true,
            errorCategory: category,
            errorMessage: message,
            link: '',
            confidenceReasons: ['Error: Failed to check domain availability.'],
            dnssecValidated: false,
            wildcardDetected: isKnownWildcardTld,
            isParkedByNs: false,
            isParkedByTxt: false
        }
    }
} 
