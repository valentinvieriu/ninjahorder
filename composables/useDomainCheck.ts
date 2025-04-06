import { ref, reactive, computed } from 'vue'
import {
  DomainAvailabilityStatus,
  ErrorCategory,
  CheckStage,
  type ProgressState,
  type DomainResult,
  generateLink,
  handleError,
  type DohProvider
} from './domain'
import checkDomainAvailability from './domain/checker'
import { DOH_PROVIDER_URLS } from '../config/appConfig'

// --- Re-export Enums and Types ---
export { DomainAvailabilityStatus, ErrorCategory, CheckStage };

// --- UI Messages ---
export const statusMessages = {
  [DomainAvailabilityStatus.AVAILABLE]: 'Available',
  [DomainAvailabilityStatus.REGISTERED]: 'Already Registered',
  [DomainAvailabilityStatus.PREMIUM]: 'Premium Domain',
  [DomainAvailabilityStatus.INDETERMINATE]: 'Status Uncertain',
  [DomainAvailabilityStatus.ERROR]: 'Check Failed'
}

export const stageMessages = {
  [CheckStage.PREPARING]: 'Preparing domain check...',
  [CheckStage.WILDCARD_CHECK]: 'Checking for wildcard DNS...',
  [CheckStage.PRIMARY_QUERY]: 'Querying primary DNS providers...',
  [CheckStage.FALLBACK_QUERY]: 'Performing additional DNS checks...',
  [CheckStage.ANALYZING]: 'Analyzing DNS responses...',
  [CheckStage.FINALIZING]: 'Finalizing results...',
  [CheckStage.COMPLETE]: 'Check complete',
  [CheckStage.CANCELLED]: 'Check cancelled',
  [CheckStage.ERROR]: 'Check error'
}

// --- Vue Composable Specifics ---
interface CacheEntry {
  results: DomainResult[]
  timestamp: number
}

interface GroupedResults {
  available: DomainResult[]
  notAvailable: DomainResult[]
  premium: DomainResult[]
  other: DomainResult[]
}

export const useDomainCheck = (options: { useWorkers?: boolean; concurrency?: number } = {}) => {
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
  let abortController: AbortController | null = null
  let currentCacheKey: string | null = null

  // Always default to using workers and set default concurrency
  const { useWorkers = true, concurrency = 5 } = options

  const groupedResults = computed<GroupedResults>(() => ({
    available: results.filter(result => result.status === DomainAvailabilityStatus.AVAILABLE),
    notAvailable: results.filter(result => result.status === DomainAvailabilityStatus.REGISTERED),
    premium: results.filter(result => result.status === DomainAvailabilityStatus.PREMIUM),
    other: results.filter(result => result.status === DomainAvailabilityStatus.INDETERMINATE || result.status === DomainAvailabilityStatus.ERROR)
  }))

  // Helper to create a DohProvider object from a URL
  const createProviderFromUrl = (url: string): DohProvider => {
    return {
      name: `Provider-${currentProviderIndex}`,
      baseUrl: url
    }
  }

  const getNextProvider = (): DohProvider => {
    const providerUrl = DOH_PROVIDER_URLS[currentProviderIndex]
    currentProviderIndex = (currentProviderIndex + 1) % DOH_PROVIDER_URLS.length
    return createProviderFromUrl(providerUrl)
  }

  const cleanupWorker = () => {
    if (worker) {
      worker.terminate()
      worker = null
    }
  }

  const cancelCheck = () => {
    if (!isChecking.value) return

    // Remove the cached entry for the current domain check if it exists
    if (currentCacheKey && cache.value[currentCacheKey]) {
      delete cache.value[currentCacheKey]
      currentCacheKey = null
    }

    // Abort all ongoing operations
    if (abortController) {
      abortController.abort()
      abortController = null
    }

    // Notify worker about cancellation if it exists
    if (worker) {
      worker.postMessage({ type: 'abort' })
      cleanupWorker()
    }

    // Update progress state
    progress.value = {
      ...progress.value,
      stage: CheckStage.CANCELLED,
      percentage: 0,
      detailedMessage: 'Domain check cancelled'
    }

    isChecking.value = false
  }

  const checkDomains = async (domainName: string, selectedTLDs: string[]) => {
    // Cancel any existing check
    if (isChecking.value) {
      cancelCheck()
    }

    const sortedTLDs = [...selectedTLDs].sort()
    const cacheKey = `${domainName}:${sortedTLDs.join(',')}`
    currentCacheKey = cacheKey
    const cachedEntry = cache.value[cacheKey]

    if (cachedEntry && Date.now() - cachedEntry.timestamp < 5 * 60 * 1000) {
      results.splice(0, results.length, ...cachedEntry.results)
      console.info(`[Domain Check] Cache hit for ${domainName} with TLDs: ${sortedTLDs.join(',')}`)
      return groupedResults.value
    }
    console.info(`[Domain Check] Cache miss or expired for ${domainName} with TLDs: ${sortedTLDs.join(',')}`)

    results.splice(0, results.length)
    progress.value = {
      percentage: 0,
      stage: CheckStage.PREPARING,
      domainsProcessed: 0,
      totalDomains: sortedTLDs.length
    }
    isChecking.value = true

    // Create new AbortController for this check
    abortController = new AbortController()
    const { signal } = abortController

    try {
      // Add event listener to handle abort events
      signal.addEventListener('abort', () => {
        console.info('[Domain Check] Operation cancelled by user')
      })

      // Only attempt to use workers if they're supported in this environment
      if (useWorkers && typeof Worker !== 'undefined') {
        cleanupWorker()
        worker = new Worker(new URL('./domainCheck.worker.ts', import.meta.url), { type: 'module' })

        return new Promise<GroupedResults>((resolve, reject) => {
          if (!worker) {
            isChecking.value = false
            reject(new Error('Worker creation failed'))
            return
          }

          // Handle abort events during the promise execution
          signal.addEventListener('abort', () => {
            reject(new Error('Domain check cancelled by user'))
          })

          worker.onmessage = (event) => {
            // If already aborted, ignore any further messages
            if (signal.aborted) return

            const data = event.data as {
              type: 'progress' | 'result' | 'error' | 'single_result';
              progress?: number;
              progressState?: Partial<ProgressState>;
              results?: DomainResult[];
              result?: DomainResult; // Single result
              message?: string;
              domain?: string;
            };

            switch (data.type) {
              case 'progress':
                if (data.progressState) {
                  progress.value = {
                    ...progress.value,
                    ...data.progressState,
                  }
                }
                break;
              case 'single_result':
                if (data.result) {
                  // Add the single result to our results array
                  const existingIndex = results.findIndex(r => r.domain === data.result!.domain);
                  if (existingIndex > -1) {
                    results[existingIndex] = data.result;
                  } else {
                    results.push(data.result);
                  }
                  
                  // Only update the cache if the check hasn't been cancelled
                  if (!signal.aborted && currentCacheKey) {
                    cache.value[currentCacheKey] = {
                      results: JSON.parse(JSON.stringify(results)),
                      timestamp: Date.now()
                    };
                  }
                }
                break;
              case 'result':
                if (Array.isArray(data.results)) {
                  // This is for backward compatibility - the full array will replace our incremental results
                  results.splice(0, results.length, ...data.results);
                  
                  // Only update the cache if the check hasn't been cancelled
                  if (!signal.aborted && currentCacheKey) {
                    cache.value[currentCacheKey] = {
                      results: JSON.parse(JSON.stringify(data.results)),
                      timestamp: Date.now()
                    };
                  }
                }
                
                progress.value = {
                  percentage: 100,
                  stage: CheckStage.COMPLETE,
                  domainsProcessed: sortedTLDs.length,
                  totalDomains: sortedTLDs.length,
                  detailedMessage: 'All domain checks complete'
                };
                
                isChecking.value = false;
                
                cleanupWorker();
                abortController = null;
                currentCacheKey = null;
                
                resolve(groupedResults.value);
                break;
              case 'error':
                console.error(`[Domain Check Worker] ${data.message || 'Unknown error'}`);
                
                if (data.domain) {
                  console.warn(`[Domain Check Worker] Error checking ${data.domain}, continuing...`);
                  progress.value.detailedMessage = `Error checking ${data.domain}`;
                  
                  const errorResult: DomainResult = {
                    domain: data.domain,
                    status: DomainAvailabilityStatus.ERROR,
                    error: true,
                    errorMessage: data.message || 'Worker error',
                    errorCategory: ErrorCategory.UNKNOWN,
                    link: generateLink(data.domain, DomainAvailabilityStatus.ERROR),
                    confidenceReasons: [`Worker reported error: ${data.message || 'Unknown'}`],
                    isParkedByNs: false,
                    isParkedByTxt: false
                  };
                  
                  const existingIndex = results.findIndex(r => r.domain === data.domain);
                  if (existingIndex > -1) {
                    results[existingIndex] = errorResult;
                  } else {
                    results.push(errorResult);
                  }
                } else {
                  isChecking.value = false;
                  cleanupWorker();
                  abortController = null;
                  reject(new Error(data.message || 'Unknown worker error'));
                }
                break;
            }
          };

          worker.onerror = (error: ErrorEvent) => {
            console.error('[Domain Check Worker] Error:', error);
            isChecking.value = false;
            cleanupWorker();
            abortController = null;
            reject(new Error('Worker error: ' + (error.message || 'Unknown error')));
          };

          worker.postMessage({
            domainName,
            tlds: sortedTLDs,
            hasSignal: true,
            concurrencyLimit: concurrency
          })
        })
      } else {
        // Fallback for environments where workers aren't supported
        console.warn('[Domain Check] Workers not supported in this environment, falling back to direct API calls')
        
        // Use the standard logic directly from our module
        const totalDomains = sortedTLDs.length
        const domainCheckPromises: Promise<DomainResult>[] = []
        
        for (const tld of sortedTLDs) {
          const fullDomain = `${domainName}${tld}`
          const provider = getNextProvider()
          
          // Create a closure to update progress for this domain
          const domainPromise = (async () => {
            try {
              // Check if operation was cancelled
              if (signal.aborted) {
                throw new Error('Operation cancelled by user')
              }
            
              // Use the existing progress object to track status
              progress.value = {
                ...progress.value,
                currentDomain: fullDomain,
                stage: CheckStage.PREPARING,
                detailedMessage: `Starting check for ${fullDomain}`
              }
              
              // Call the core domain checking logic with the abort signal
              const result = await checkDomainAvailability(fullDomain, [provider], signal)
              
              // Update progress
              progress.value.domainsProcessed++
              progress.value.percentage = (progress.value.domainsProcessed / totalDomains) * 95
              progress.value.stage = CheckStage.FINALIZING
              progress.value.detailedMessage = `Completed check for ${fullDomain}`
              
              return result
            } catch (error) {
              // If cancelled, rethrow
              if (signal.aborted) {
                throw error
              }
            
              // Update progress even when error occurs
              progress.value.domainsProcessed++
              progress.value.percentage = (progress.value.domainsProcessed / totalDomains) * 95
              progress.value.stage = CheckStage.FINALIZING
              progress.value.detailedMessage = `Error checking ${fullDomain}`
              
              // Handle the error
              const { category, message, suggestsDomainExists } = handleError(
                `Domain check for ${fullDomain}`,
                error as Error,
                fullDomain
              )
              
              const status = suggestsDomainExists 
                ? DomainAvailabilityStatus.REGISTERED 
                : DomainAvailabilityStatus.ERROR
                
              return {
                domain: fullDomain,
                status,
                error: status === DomainAvailabilityStatus.ERROR,
                errorCategory: category,
                errorMessage: message,
                link: generateLink(fullDomain, status),
                confidenceReasons: [
                  `Error during check: ${message}`,
                  suggestsDomainExists 
                    ? 'Error type suggests domain might be registered.' 
                    : 'Could not determine status.'
                ],
                dnssecValidated: false,
                wildcardDetected: false,
                isParkedByNs: false,
                isParkedByTxt: false
              }
            }
          })()
          
          domainCheckPromises.push(domainPromise)
        }
        
        progress.value.stage = CheckStage.FINALIZING
        progress.value.detailedMessage = 'Waiting for all domain queries to complete...'
        
        try {
          // Wait for all domain checks to complete, but allow for cancellation
          const settledResults = await Promise.allSettled(domainCheckPromises)
          
          // If operation was cancelled, stop processing
          if (signal.aborted) {
            throw new Error('Operation cancelled by user')
          }
          
          // Process results
          const finalResults: DomainResult[] = settledResults.map((result, index) => {
            const fullDomain = `${domainName}${sortedTLDs[index]}`
            if (result.status === 'fulfilled') {
              return result.value
            } else {
              // Handle any unexpected errors
              console.error(`[Domain Check] Unexpected rejection for ${fullDomain}:`, result.reason)
              
              // If it was a cancellation, propagate that
              if (result.reason instanceof Error && result.reason.name === 'AbortError') {
                throw result.reason
              }
              
              const { category, message } = handleError(
                `Unexpected error for ${fullDomain}`,
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
                dnssecValidated: false,
                wildcardDetected: false,
                isParkedByNs: false,
                isParkedByTxt: false
              }
            }
          })
          
          // Update final results
          results.splice(0, results.length, ...finalResults)
          
          // Update progress to complete
          progress.value = {
            percentage: 100,
            stage: CheckStage.COMPLETE,
            domainsProcessed: totalDomains,
            totalDomains,
            detailedMessage: 'All domain checks complete'
          }
          
          // Only update the cache if the check hasn't been cancelled
          if (!signal.aborted && currentCacheKey) {
            cache.value[currentCacheKey] = {
              results: JSON.parse(JSON.stringify(finalResults)),
              timestamp: Date.now()
            }
          }
          
          isChecking.value = false
          abortController = null
          currentCacheKey = null
          return groupedResults.value
        } catch (error) {
          // If operation was cancelled, update progress
          if (error instanceof Error && (error.name === 'AbortError' || signal.aborted)) {
            progress.value = {
              ...progress.value,
              stage: CheckStage.CANCELLED,
              detailedMessage: 'Domain check cancelled'
            }
            isChecking.value = false
            abortController = null
            currentCacheKey = null
            return groupedResults.value
          }
          
          // Rethrow other errors
          throw error
        }
      }
    } catch (error) {
      // If operation was cancelled by the user, handle accordingly
      if (error instanceof Error && (error.name === 'AbortError' || signal?.aborted)) {
        console.info('[Domain Check] Operation cancelled by user')
        progress.value = {
          ...progress.value,
          stage: CheckStage.CANCELLED,
          detailedMessage: 'Domain check cancelled'
        }
      } else {
        console.error('[Domain Check] Error:', error)
      }
      
      isChecking.value = false
      cleanupWorker()
      abortController = null
      currentCacheKey = null
      
      // Only throw non-cancellation errors
      if (!(error instanceof Error && (error.name === 'AbortError' || signal?.aborted))) {
        throw error
      }
      
      return groupedResults.value
    }
  }

  return {
    checkDomains,
    cancelCheck,
    results,
    progress,
    isChecking,
    groupedResults,
    statusMessages,
    stageMessages
  }
}

// Remove unnecessary wrapper function since we now default to workers
export const useDomainCheckWithWorkers = useDomainCheck