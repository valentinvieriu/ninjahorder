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
import { buildDomainCheckCacheKey } from './domain/cache'
import checkDomainAvailability from './domain/checker'

// --- Re-export Enums and Types ---
export { DomainAvailabilityStatus, ErrorCategory, CheckStage };
export { buildDomainCheckCacheKey };

// --- UI Messages ---
// "Likely Available — Verify" rather than "Available": this app uses recursive
// DNS only, which cannot prove registry availability (NXDOMAIN can hide
// registered-but-undelegated, reserved, or premium names). The phrasing nudges
// the user to confirm with a registrar/RDAP before acting.
export const statusMessages = {
  [DomainAvailabilityStatus.AVAILABLE]: 'Likely Available — Verify',
  [DomainAvailabilityStatus.REGISTERED]: 'Already Registered',
  [DomainAvailabilityStatus.PREMIUM]: 'Premium Domain',
  [DomainAvailabilityStatus.INDETERMINATE]: 'Status Uncertain',
  [DomainAvailabilityStatus.ERROR]: 'Check Failed'
}

export const stageMessages = {
  [CheckStage.PREPARING]: 'Preparing domain list...',
  [CheckStage.WILDCARD_CHECK]: 'Checking for wildcard DNS configuration...',
  [CheckStage.PRIMARY_QUERY]: 'Performing primary domain checks...',
  [CheckStage.FALLBACK_QUERY]: 'Performing fallback/validation checks...',
  [CheckStage.CONFIRMATION_QUERY]: 'Confirming availability status...',
  [CheckStage.RDAP_QUERY]: 'Verifying registry data...',
  [CheckStage.ANALYZING]: 'Analyzing results...',
  [CheckStage.FINALIZING]: 'Finalizing and sorting results...',
  [CheckStage.COMPLETE]: 'Check complete!',
  [CheckStage.CANCELLED]: 'Check cancelled by user.',
  [CheckStage.ERROR]: 'An error occurred during the check.'
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

interface CheckDomainOptions {
  verifyWithRdap?: boolean
}

export const useDomainCheck = (options: { concurrency?: number } = {}) => {
  const results = reactive<DomainResult[]>([])
  const progress = ref<ProgressState>({
    percentage: 0,
    stage: CheckStage.PREPARING,
    domainsProcessed: 0,
    totalDomains: 0
  })
  const isChecking = ref(false)
  const cache = ref<Record<string, CacheEntry>>({})
  let worker: Worker | null = null
  let abortController: AbortController | null = null
  let currentCacheKey: string | null = null

  // Always default concurrency, removed useWorkers
  const { concurrency = 5 } = options

  const groupedResults = computed<GroupedResults>(() => ({
    available: results.filter(result => result.status === DomainAvailabilityStatus.AVAILABLE),
    notAvailable: results.filter(result => result.status === DomainAvailabilityStatus.REGISTERED),
    premium: results.filter(result => result.status === DomainAvailabilityStatus.PREMIUM),
    other: results.filter(result => result.status === DomainAvailabilityStatus.INDETERMINATE || result.status === DomainAvailabilityStatus.ERROR)
  }))

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

  const checkDomains = async (
    domainName: string,
    selectedTLDs: string[],
    checkOptions: CheckDomainOptions = {}
  ) => {
    // Cancel any existing check
    if (isChecking.value) {
      cancelCheck()
    }

    // Normalize input so 'Foo  ' and 'foo' share a cache entry and produce the
    // same FQDNs in the worker. IDN/punycode is intentionally not handled here
    // — the form regex blocks non-ASCII labels today, and a punycode conversion
    // step belongs alongside a relaxed form validation.
    const verifyWithRdap = Boolean(checkOptions.verifyWithRdap)
    const { cacheKey, normalizedDomain, sortedTLDs } = buildDomainCheckCacheKey(
      domainName,
      selectedTLDs,
      verifyWithRdap
    )
    currentCacheKey = cacheKey
    const cachedEntry = cache.value[cacheKey]

    if (cachedEntry && Date.now() - cachedEntry.timestamp < 5 * 60 * 1000) {
      results.splice(0, results.length, ...cachedEntry.results)
      console.info(`[Domain Check] Cache hit for ${normalizedDomain} with TLDs: ${sortedTLDs.join(',')}`)
      return groupedResults.value
    }
    console.info(`[Domain Check] Cache miss or expired for ${normalizedDomain} with TLDs: ${sortedTLDs.join(',')}`)

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

      // --- Start of Worker Logic (Now the only path) ---
      cleanupWorker()
      // Ensure Worker constructor exists (though we assume it does)
      if (typeof Worker === 'undefined') {
         console.error('[Domain Check] Web Workers are not supported in this environment. Cannot proceed.');
         isChecking.value = false;
         progress.value = {
            ...progress.value,
            stage: CheckStage.ERROR,
            percentage: 0,
            detailedMessage: 'Web Workers are required but not supported.'
         };
         // Optionally throw an error or return an empty/error state
         // For now, just log and set state.
         return groupedResults.value; // Return current (likely empty) results
      }

      worker = new Worker(new URL('./domainCheck.worker.ts', import.meta.url), { type: 'module' })

      return new Promise<GroupedResults>((resolve, reject) => {
        if (!worker) {
          isChecking.value = false
          reject(new Error('Worker creation failed'))
          return
        }

        // Handle abort events during the promise execution
        signal.addEventListener('abort', () => {
          // Clean up and reject if aborted before worker interaction completes fully
          if (isChecking.value) { // Only reject if still in 'checking' state
             cleanupWorker();
             abortController = null;
             currentCacheKey = null; // Clear cache key on abort
             isChecking.value = false; // Ensure state is updated
             progress.value = { // Update progress on abort
                ...progress.value,
                stage: CheckStage.CANCELLED,
                percentage: 0,
                detailedMessage: 'Domain check cancelled by user'
             };
             // Reject the promise to signal cancellation upstream
             reject(new Error('Domain check cancelled by user'));
          }
        });

        worker.onmessage = (event) => {
          // If already aborted, ignore any further messages
          if (signal.aborted) return

          const data = event.data as {
            type: 'progress' | 'error' | 'single_result';
            progress?: number;
            progressState?: Partial<ProgressState>;
            result?: DomainResult;
            message?: string;
            domain?: string;
          };

          switch (data.type) {
            case 'progress':
              if (data.progressState) {
                progress.value = {
                  ...progress.value,
                  ...data.progressState,
                };

                const isBatchComplete =
                  data.progressState.stage === CheckStage.COMPLETE &&
                  progress.value.totalDomains > 0 &&
                  progress.value.domainsProcessed >= progress.value.totalDomains;

                if (isBatchComplete) {
                  isChecking.value = false;
                  cleanupWorker();
                  abortController = null;

                  if (currentCacheKey) {
                     // Only cache a run where every result was definitive. Caching
                     // a run that contains INDETERMINATE or ERROR rows would pin
                     // transient failures for the full TTL and stop the user from
                     // recovering by re-checking the same domain. A partial cache
                     // would also misrepresent the run on cache hit.
                     const allDefinitive = results.every(result =>
                        result.status !== DomainAvailabilityStatus.INDETERMINATE &&
                        result.status !== DomainAvailabilityStatus.ERROR
                     );

                     if (allDefinitive && results.length > 0) {
                        cache.value[currentCacheKey] = {
                           results: JSON.parse(JSON.stringify(results)),
                           timestamp: Date.now()
                        };
                     }
                     currentCacheKey = null;
                  }

                  resolve(groupedResults.value);
                }
                else if (data.progressState.stage === CheckStage.CANCELLED) {
                    isChecking.value = false;
                    cleanupWorker();
                    abortController = null;
                    currentCacheKey = null;
                }
                else if (data.progressState.stage === CheckStage.ERROR) {
                    isChecking.value = false;
                    cleanupWorker();
                    abortController = null;
                    currentCacheKey = null;
                    reject(new Error(data.progressState.detailedMessage || 'Worker reported an error state'));
                }
              }
              break;
            case 'single_result':
              if (data.result) {
                const existingIndex = results.findIndex(r => r.domain === data.result!.domain);
                if (existingIndex > -1) {
                  results[existingIndex] = data.result;
                } else {
                  results.push(data.result);
                }
              }
              break;
            case 'error':
              console.error(`[Domain Check Worker] ${data.message || 'Unknown error'}`);

              if (data.domain) {
                console.warn(`[Domain Check Worker] Error checking ${data.domain}, attempting to continue...`);
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
                currentCacheKey = null;
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
          domainName: normalizedDomain,
          tlds: sortedTLDs,
          concurrencyLimit: concurrency,
          verifyWithRdap
        })
      })
      // --- End of Worker Logic ---

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
// export const useDomainCheckWithWorkers = useDomainCheck
