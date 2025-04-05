import { ref, reactive, computed } from 'vue'
import {
  checkDomainAvailability,
  handleError,
  generateLink,
  DomainAvailabilityStatus,
  ErrorCategory,
  CheckStage,
} from './domainCheckerLogic'
import type { ProgressState, DomainResult } from './domainCheckerLogic'
import { DOH_PROVIDER_URLS } from '../config/appConfig'

// --- Re-export Enums and Types ---
export { DomainAvailabilityStatus, ErrorCategory, CheckStage };
export type { ProgressState, DomainResult };

// --- UI Messages (Stay Here) ---
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
  [CheckStage.COMPLETE]: 'Check complete'
}

// --- Vue Composable Specifics (Stay Here) ---
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

  // Always default to using workers
  const { useWorkers = true } = options

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

  const cleanupWorker = () => {
    if (worker) {
      worker.terminate()
      worker = null
    }
  }

  const checkDomains = async (domainName: string, selectedTLDs: string[]) => {
    const sortedTLDs = [...selectedTLDs].sort()
    const cacheKey = `${domainName}:${sortedTLDs.join(',')}`
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

    try {
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
                  progress.value = {
                    ...progress.value,
                    ...data.progressState,
                  }
                }
                break;
              case 'result':
                if (Array.isArray(data.results)) {
                  results.splice(0, results.length, ...data.results);
                  
                  cache.value[cacheKey] = {
                    results: JSON.parse(JSON.stringify(data.results)),
                    timestamp: Date.now()
                  };
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
                  }
                } else {
                  isChecking.value = false;
                  cleanupWorker();
                  reject(new Error(data.message || 'Unknown worker error'));
                }
                break;
            }
          };

          worker.onerror = (error: ErrorEvent) => {
            console.error('[Domain Check Worker] Error:', error);
            isChecking.value = false;
            cleanupWorker();
            reject(new Error('Worker error: ' + (error.message || 'Unknown error')));
          };

          worker.postMessage({
            domainName,
            tlds: sortedTLDs
          })
        })
      } else {
        // Fallback for environments where workers aren't supported
        console.warn('[Domain Check] Workers not supported in this environment, falling back to direct API calls')
        
        // Use the standard logic directly from domainCheckerLogic
        // instead of duplicating the implementation
        const totalDomains = sortedTLDs.length
        const domainCheckPromises: Promise<DomainResult>[] = []
        
        for (const tld of sortedTLDs) {
          const fullDomain = `${domainName}${tld}`
          const wildcardProviderUrl = DOH_PROVIDER_URLS[currentProviderIndex]
          currentProviderIndex = (currentProviderIndex + 1) % DOH_PROVIDER_URLS.length
          
          // Create a closure to update progress for this domain
          const domainPromise = (async () => {
            try {
              // Use the existing progress object to track status
              progress.value = {
                ...progress.value,
                currentDomain: fullDomain,
                stage: CheckStage.PREPARING,
                detailedMessage: `Starting check for ${fullDomain}`
              }
              
              // Call the core domain checking logic
              const result = await checkDomainAvailability(fullDomain, wildcardProviderUrl)
              
              // Update progress
              progress.value.domainsProcessed++
              progress.value.percentage = (progress.value.domainsProcessed / totalDomains) * 95
              progress.value.stage = CheckStage.FINALIZING
              progress.value.detailedMessage = `Completed check for ${fullDomain}`
              
              return result
            } catch (error) {
              // Update progress even when error occurs
              progress.value.domainsProcessed++
              progress.value.percentage = (progress.value.domainsProcessed / totalDomains) * 95
              progress.value.stage = CheckStage.FINALIZING
              progress.value.detailedMessage = `Error checking ${fullDomain}`
              
              // Handle the error
              const { category, message, suggestsDomainExists } = handleError(
                'Domain check failed',
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
                dnssecValidated: undefined,
                wildcardDetected: undefined,
                isParkedByNs: false,
                isParkedByTxt: false
              }
            }
          })()
          
          domainCheckPromises.push(domainPromise)
        }
        
        progress.value.stage = CheckStage.FINALIZING
        progress.value.detailedMessage = 'Waiting for all domain queries to complete...'
        
        // Wait for all domain checks to complete
        const settledResults = await Promise.allSettled(domainCheckPromises)
        
        // Process results
        const finalResults: DomainResult[] = settledResults.map((result, index) => {
          const fullDomain = `${domainName}${sortedTLDs[index]}`
          if (result.status === 'fulfilled') {
            return result.value
          } else {
            // Handle any unexpected errors
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
        
        // Cache results
        cache.value[cacheKey] = {
          results: JSON.parse(JSON.stringify(finalResults)),
          timestamp: Date.now()
        }
        
        isChecking.value = false
        return groupedResults.value
      }
    } catch (error) {
      console.error('[Domain Check] Error:', error)
      isChecking.value = false
      cleanupWorker()
      throw error
    }
  }

  return {
    checkDomains,
    results,
    progress,
    isChecking,
    groupedResults,
    statusMessages,
    stageMessages
  }
}

// Remove the dedicated worker version since we now default to workers
// and keep the composable name for backward compatibility
export const useDomainCheckWithWorkers = () => useDomainCheck();