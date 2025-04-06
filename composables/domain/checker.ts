import { type DnsResponse } from '~/utils/DohResolver'
import { KNOWN_WILDCARD_TLDS } from '~/config/appConfig'
import { 
  DNS_RECORD_TYPE_NS, 
  DNS_RECORD_TYPE_SOA, 
  DNS_RECORD_TYPE_TXT,
  DNS_STATUS_NOERROR,
  DNS_STATUS_SERVFAIL,
  DOMAIN_CHECK_ERRORS_SUGGESTING_DOMAIN_EXISTS 
} from './constants'
import { 
  handleError, 
  fetchDnsJson, 
  checkWildcardDNS,
  type DohProvider
} from './dns'
import { 
  interpretCombinedResults 
} from './analysis/interpretation'
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
async function performConfirmationCheck(
    domain: string,
    providers: DohProvider[],
    abortSignal?: AbortSignal
): Promise<{ 
    status: 'fulfilled', 
    value: DnsResponse, 
    provider: string, 
    queryType: number 
}[] | { 
    status: 'rejected', 
    reason: Error, 
    provider: string, 
    queryType: number, 
    errorCategory?: ErrorCategory, 
    errorMessage?: string, 
    suggestsDomainExists?: boolean 
}[]> {
    // Use a subset of providers, focusing on the reliable ones
    const confirmationProviders = providers.slice(0, 2); // Use first two providers
    const queryPromises: Promise<any>[] = [];
    
    // Focus on SOA records for confirmation as they're definitive
    confirmationProviders.forEach(provider => {
        queryPromises.push(
            fetchDnsJson(provider, domain, DNS_RECORD_TYPE_SOA, abortSignal)
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
    
    // Extract TLD from domain for wildcard checks
    const domainSplit = domain.split('.')
    const tld = domainSplit.length > 1 ? domainSplit[domainSplit.length - 1] : null
    const isKnownWildcardTld = tld ? KNOWN_WILDCARD_TLDS.has(tld) : false
    
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
        
        // Check for wildcard DNS - Fix: only pass the required two arguments
        const wildcardCheckDomain = `wildcard-check-${Math.random().toString(36).substring(2)}.${domain}`
        const isWildcard = await checkWildcardDNS(wildcardCheckDomain, providers[0])
        
        if (isWildcard) {
            confidenceReasons.push(`Wildcard DNS detected with random subdomain check to ${wildcardCheckDomain}.`)
        }
        
        // Check if aborted after wildcard check
        if (abortSignal?.aborted) {
            throw new Error('Operation aborted after wildcard check')
        }
        
        updateProgressState(CheckStage.PRIMARY_QUERY, 25, `Performing primary DNS queries for ${domain}...`)
        
        // List of query promises to collect
        const queryPromises: Promise<{
            status: 'fulfilled',
            value: DnsResponse,
            provider: string,
            queryType: number
        } | {
            status: 'rejected',
            reason: Error,
            provider: string,
            queryType: number,
            errorCategory?: ErrorCategory,
            errorMessage?: string,
            suggestsDomainExists?: boolean
        }>[] = []
        
        // Track errors that suggest domain might exist
        let totalErrorsSuggestingDomainExists = 0
        
        // Run DNS queries across all providers and record types
        const primaryProviderNames = providers.slice(0, 1).map(p => p.name)
        
        providers.forEach(provider => {
            const isPrimaryProvider = primaryProviderNames.includes(provider.name)
            
            // Query for NS records
            queryPromises.push(
                fetchDnsJson(provider, domain, DNS_RECORD_TYPE_NS, abortSignal)
                    .then(value => ({ status: 'fulfilled' as const, value, provider: provider.name, queryType: DNS_RECORD_TYPE_NS }))
                    .catch(error => {
                        const { category, message, suggestsDomainExists } = handleError(
                          `NS query from ${provider.name}`,
                          error instanceof Error ? error : new Error(String(error)),
                          domain
                        )
                        
                        if (suggestsDomainExists) {
                            totalErrorsSuggestingDomainExists += isPrimaryProvider ? 2 : 1
                        }
                        
                        return {
                            status: 'rejected' as const,
                            reason: error instanceof Error ? error : new Error(String(error)),
                            provider: provider.name,
                            queryType: DNS_RECORD_TYPE_NS,
                            errorCategory: category,
                            errorMessage: message,
                            suggestsDomainExists
                        }
                    })
            )
            
            // Only query SOA for primary provider (to reduce load)
            if (isPrimaryProvider) {
                queryPromises.push(
                    fetchDnsJson(provider, domain, DNS_RECORD_TYPE_SOA, abortSignal)
                        .then(value => ({ status: 'fulfilled' as const, value, provider: provider.name, queryType: DNS_RECORD_TYPE_SOA }))
                        .catch(error => {
                            const { category, message, suggestsDomainExists } = handleError(
                              `SOA query from ${provider.name}`,
                              error instanceof Error ? error : new Error(String(error)),
                              domain
                            )
                            
                            if (suggestsDomainExists) {
                                totalErrorsSuggestingDomainExists += 2 // weight primary provider errors more
                            }
                            
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
            }
            
            // Query for TXT records (for parking detection)
            queryPromises.push(
                fetchDnsJson(provider, domain, DNS_RECORD_TYPE_TXT, abortSignal)
                    .then(value => ({ status: 'fulfilled' as const, value, provider: provider.name, queryType: DNS_RECORD_TYPE_TXT }))
                    .catch(error => {
                        const { category, message, suggestsDomainExists } = handleError(
                          `TXT query from ${provider.name}`,
                          error instanceof Error ? error : new Error(String(error)),
                          domain
                        )
                        
                        if (suggestsDomainExists) {
                            totalErrorsSuggestingDomainExists += isPrimaryProvider ? 2 : 1
                        }
                        
                        return {
                            status: 'rejected' as const,
                            reason: error instanceof Error ? error : new Error(String(error)),
                            provider: provider.name,
                            queryType: DNS_RECORD_TYPE_TXT,
                            errorCategory: category,
                            errorMessage: message,
                            suggestsDomainExists
                        }
                    })
            )
        })
        
        // Check if aborted before analyzing
        if (abortSignal?.aborted) {
            throw new Error('Operation aborted during DNS queries')
        }
        
        updateProgressState(CheckStage.ANALYZING, 50, `Analyzing DNS query results for ${domain}...`)
        
        // Wait for all DNS queries to complete
        const results = await Promise.allSettled(queryPromises)
        const providerResults = results.map(result => {
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
                
                // We're now stricter in our interpretation - any sign of existence means it's not available
                const anyRecordsFound = confirmationResults.some(result => 
                    result.status === 'fulfilled' && 
                    result.value.Status === DNS_STATUS_NOERROR &&
                    (result.value.Answer?.length || result.value.Authority?.length)
                );
                
                const anyServfailOrSuggestiveErrors = confirmationResults.some(result =>
                    (result.status === 'fulfilled' && result.value.Status === DNS_STATUS_SERVFAIL) ||
                    (result.status === 'rejected' && result.suggestsDomainExists)
                );
                
                if (anyRecordsFound || anyServfailOrSuggestiveErrors) {
                    // Any signs of existence mean we should be conservative
                    confidenceReasons.push("Confirmation check found signs of domain existence. Marking as indeterminate.");
                    domainResult.status = DomainAvailabilityStatus.INDETERMINATE;
                } else {
                    // All confirmations still suggest availability
                    confidenceReasons.push("Confirmation check supports availability finding.");
                    domainResult.status = DomainAvailabilityStatus.AVAILABLE;
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