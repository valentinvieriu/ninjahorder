/* Domain Check Worker
 * This worker processes domain availability checks in the background,
 * preventing UI freezes when checking multiple domains at once.
 */

// Import from new domain module
import checkDomainAvailability from './domain/checker';
import {
  generateLink,
  handleError,
  DomainAvailabilityStatus,
  type DomainResult,
  type ProgressState,
  CheckStage,
  ErrorCategory,
  type DohProvider
} from './domain';

// Import constants from config
import { DOH_PROVIDER_URLS } from '../config/appConfig';

// Define the interfaces needed for worker communication based on imported types
interface DomainCheckRequest {
  domainName: string;
  tlds: string[];
  // Optionally receive provider URLs if they can't be imported directly in worker context
  // dohProviderUrls?: string[];
  concurrencyLimit?: number; // Optional concurrency limit parameter
}

// Use imported ProgressState for progress messages
interface DomainCheckProgress {
  type: 'progress';
  progressState: Partial<ProgressState>; // Use partial as we update parts
}

// Use imported DomainResult for result messages
interface DomainCheckResult {
  type: 'result';
  results: DomainResult[]; // Use the imported type
}

interface DomainCheckSingleResult {
  type: 'single_result';
  result: DomainResult; // Single result
}

interface DomainCheckError {
  type: 'error';
  message: string;
  domain?: string; // Specific domain error
}

// --- Constants for Weighted Progress ---
const STAGE_WEIGHTS = {
  [CheckStage.PREPARING]: 0.02,         // 2%
  [CheckStage.WILDCARD_CHECK]: 0.08,    // 8% (Total 10%)
  [CheckStage.PRIMARY_QUERY]: 0.60,     // 60% (Total 70%)
  [CheckStage.CONFIRMATION_QUERY]: 0.15,// 15% (Total 85%) - Assuming confirmation/fallback happens here
  [CheckStage.ANALYZING]: 0.05,         // 5%  (Total 90%)
  [CheckStage.FINALIZING]: 0.10,        // 10% (Total 100%)
  // Other stages like COMPLETE, CANCELLED, ERROR don't contribute to weighted progress directly
};

// Helper to calculate base progress percentage for a given stage
const calculateStageBaseProgress = (targetStage: CheckStage): number => {
  let baseProgress = 0;
  for (const stage in STAGE_WEIGHTS) {
    if (stage === targetStage) break;
    // Check if the stage exists in STAGE_WEIGHTS before adding
    if (Object.prototype.hasOwnProperty.call(STAGE_WEIGHTS, stage)) {
       baseProgress += STAGE_WEIGHTS[stage as keyof typeof STAGE_WEIGHTS];
    }
  }
  return baseProgress * 100;
};

// --- Worker State ---
let currentWildcardProviderIndex = 0; // Keep track of provider for wildcard checks
let activeProviders = new Map<string, boolean>(); // Track active and failed providers
let currentAbortController: AbortController | null = null; // Abort controller for the worker

// Helper to get next provider URL for wildcard checks
const getNextWildcardProviderUrl = (): DohProvider => {
    // Use the imported DOH_PROVIDER_URLS
    const providerUrl = DOH_PROVIDER_URLS[currentWildcardProviderIndex];
    currentWildcardProviderIndex = (currentWildcardProviderIndex + 1) % DOH_PROVIDER_URLS.length;
    
    // Initialize provider status if not already tracking
    if (!activeProviders.has(providerUrl)) {
      activeProviders.set(providerUrl, true); // Mark as active by default
    }
    
    // Convert URL to DohProvider object
    return {
      name: `Provider-${currentWildcardProviderIndex}`,
      baseUrl: providerUrl,
    };
}

// Track provider status
const updateProviderStatus = (providerUrl: string, isActive: boolean) => {
  activeProviders.set(providerUrl, isActive);
  
  // Convert map to array for progress updates
  const providersArray = Array.from(activeProviders.entries()).map(([url, active]) => ({
    url,
    active
  }));
  
  return providersArray;
}

// Simple concurrency limiter implementation
class ConcurrencyLimiter {
  private running = 0;
  private queue: (() => void)[] = [];

  constructor(private readonly maxConcurrent: number) {}

  async add<T>(fn: () => Promise<T>): Promise<T> {
    // Wait if we've reached the concurrency limit
    if (this.running >= this.maxConcurrent) {
      await new Promise<void>(resolve => {
        this.queue.push(resolve);
      });
    }

    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        next?.();
      }
    }
  }
}

// --- Message Handler ---

// --- Refined Progress Update Function (Defined outside onmessage) ---
// It needs access to the signal, state variables, and postMessage
const postProgressUpdate = (
    signal: AbortSignal | null, // Pass signal
    postMessageFn: (message: any) => void, // Pass postMessage
    stage: CheckStage,
    domainsProcessed: number, // Pass state
    totalDomains: number, // Pass state
    activeProviders: Map<string, boolean>, // Pass state
    errorMessages: string[], // Pass state
    totalRetries: number, // Pass state
    stageProgressPercent: number = 0,
    detailedMessageOverride?: string,
    currentDomainOverride?: string | null
) => {
    // If aborted, do nothing
    if (signal?.aborted) return;

    const baseProgress = calculateStageBaseProgress(stage);
    const stageWeight = STAGE_WEIGHTS[stage as keyof typeof STAGE_WEIGHTS] || 0;
    const overallPercentage = Math.min(99, Math.round(baseProgress + (stageProgressPercent * stageWeight))); // Cap at 99

    const providersArray = Array.from(activeProviders.entries()).map(([url, active]) => ({ url, active }));

    const progressState: Partial<ProgressState> = {
        percentage: overallPercentage,
        stage: stage,
        domainsProcessed: domainsProcessed,
        totalDomains: totalDomains,
        providers: providersArray,
        errors: errorMessages.length > 0 ? [...errorMessages] : undefined,
        retriesAttempted: totalRetries,
        detailedMessage: detailedMessageOverride,
        currentDomain: currentDomainOverride === null ? undefined : (currentDomainOverride || undefined)
    };

    // Set specific message if not overridden
    if (!detailedMessageOverride) {
        switch (stage) {
            case CheckStage.PRIMARY_QUERY:
            case CheckStage.CONFIRMATION_QUERY:
                progressState.detailedMessage = `Stage: ${stage}. Processed ${domainsProcessed} of ${totalDomains} domains...`;
                break;
             default:
                progressState.detailedMessage = `Executing stage: ${stage}`;
        }
    }

    postMessageFn({ type: 'progress', progressState } as DomainCheckProgress);
};

// --- Actual Worker Message Handler ---
self.onmessage = async (event: MessageEvent<DomainCheckRequest | { type: 'abort' }>) => {
  // Handle abort message
  // Check if type property exists and equals 'abort'
  if (typeof event.data === 'object' && event.data !== null && 'type' in event.data && event.data.type === 'abort') {
    console.log('Worker: Received abort signal.');
    currentAbortController?.abort();
    return;
  }

  // --- Declare state variables outside try block ---
  let domainsProcessed = 0;
  let totalDomains = 0;
  const errorMessages: string[] = [];
  const results: DomainResult[] = [];
  let totalRetries = 0;
  // -------------------------------------------------

  // Existing logic for DomainCheckRequest
  const { domainName, tlds, concurrencyLimit = 5 } = event.data as DomainCheckRequest;

  // Create a new AbortController for this specific job
  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;

  // --- Define updateProgress wrapper function HERE (outside try block) ---
  const updateProgress = (stage: CheckStage, stageProgressPercent: number = 0, detailedMessageOverride?: string, currentDomainOverride?: string | null) => {
      // Check signal before proceeding
      if (signal?.aborted) return;

      postProgressUpdate(
          signal, // Pass current signal
          self.postMessage.bind(self), // Pass postMessage function
          stage,
          domainsProcessed, // Access outer scope variable
          totalDomains,
          activeProviders,
          errorMessages,
          totalRetries,
          stageProgressPercent,
          detailedMessageOverride,
          currentDomainOverride
      );
  };
  // -----------------------------------------------------------

  try {
    // Reset state for new job (except variables declared outside)
    currentWildcardProviderIndex = 0;
    activeProviders = new Map<string, boolean>();
    // Clear arrays/maps if needed
    errorMessages.length = 0;
    results.length = 0;
    totalRetries = 0;

    // Assign totalDomains here where tlds is known
    totalDomains = tlds.length;

    if (!domainName || !tlds || !Array.isArray(tlds) || tlds.length === 0) {
      throw new Error('Invalid request: domainName and tlds array are required');
    }

    // --- Check Execution Flow ---

    // 1. Preparing Stage
    updateProgress(CheckStage.PREPARING, 0, 'Preparing domain checks...');

    // Simulate some preparation time if needed, or move directly to next stage
    // await new Promise(resolve => setTimeout(resolve, 50)); // Optional delay

    // Check if aborted after preparing
    if (signal.aborted) throw new Error('Aborted during preparation');

    // 2. Wildcard Check (Example - adapt if your logic is different)
    // Assuming wildcard check happens before individual domain checks
    // You might need to adjust this based on checkDomainAvailability's internal stages
    updateProgress(CheckStage.WILDCARD_CHECK, 0, 'Checking for wildcard DNS...');
    // --- Perform actual wildcard check here ---
    // For now, simulate completion
    // await performWildcardCheck(domainName, signal);
    updateProgress(CheckStage.WILDCARD_CHECK, 100, 'Wildcard check complete.'); // Mark stage as complete

    // Check if aborted after wildcard check
    if (signal.aborted) throw new Error('Aborted during wildcard check');

    // 3. Primary Query Stage
    const limiter = new ConcurrencyLimiter(concurrencyLimit);
    updateProgress(CheckStage.PRIMARY_QUERY, 0, `Starting primary checks for ${totalDomains} domains...`, null);

    const checkPromises = tlds.map((tld, index) => limiter.add(async () => {
        // Check abort signal before starting each domain
        if (signal.aborted) return null; // Return null or throw to stop processing this domain

        const fullDomain = `${domainName}${tld}`;
        let result: DomainResult | null = null;
        let providerForThisCheck: DohProvider | null = null; // Declare outside try

        try {
            // Post update before starting the check for *this* domain
            updateProgress(
                CheckStage.PRIMARY_QUERY,
                (domainsProcessed / (totalDomains || 1)) * 100, // Use safe division
                `Checking ${fullDomain} (${domainsProcessed + 1}/${totalDomains})...`,
                fullDomain
            );

            providerForThisCheck = getNextWildcardProviderUrl(); // Assign provider
            updateProviderStatus(providerForThisCheck.baseUrl, true); // Assume active initially

            // Perform the check using checkDomainAvailability
            result = await checkDomainAvailability(
                fullDomain,
                [providerForThisCheck], // Pass provider(s)
                signal, // Pass the abort signal
                (checkerProgress: ProgressState) => {
                    // ---- INTERNAL PROGRESS CALLBACK from checkDomainAvailability ----
                    // Use this to update the *detailed message* or *current sub-task*
                    // Avoid recalculating overall percentage here, let the main loop handle that
                     if (signal.aborted) return;
                     // Use updateProgress which calls postProgressUpdate
                     updateProgress(
                        CheckStage.PRIMARY_QUERY,
                         (domainsProcessed / (totalDomains || 1)) * 100, // Keep stage progress based on completed domains
                         checkerProgress.detailedMessage || `Checking ${fullDomain}...`, // Use detailed message from checker
                         fullDomain
                     );
                     // Update provider status based on checker's feedback if possible
                     if(checkerProgress.providers) {
                         checkerProgress.providers.forEach(p => updateProviderStatus(p.url, p.active));
                     }
                }
            );

            // Check succeeded
             updateProviderStatus(providerForThisCheck.baseUrl, true);
            if (result.retriesAttempted) {
                totalRetries += result.retriesAttempted;
            }

        } catch (error: any) {
             // Check failed
             if (providerForThisCheck) {
                updateProviderStatus(providerForThisCheck.baseUrl, false); // Mark provider as failed for this check
             }

             if (error.name === 'AbortError' || signal.aborted) {
                 console.log(`Worker: Check for ${fullDomain} aborted.`);
                 // Don't treat abort as a domain error, just stop processing it.
                 return null; // Indicate aborted check for this domain
             }

            console.error(`Worker: Error checking ${fullDomain}:`, error);
            const { category, message, suggestsDomainExists } = handleError(
                `Worker check for ${fullDomain}`,
                error, // Pass the error object
                fullDomain // Pass the domain as the third argument
            );
            errorMessages.push(`${fullDomain}: ${message}`);

            // Create an error result object
            const statusOnError = suggestsDomainExists ? DomainAvailabilityStatus.INDETERMINATE : DomainAvailabilityStatus.ERROR;
            result = {
                domain: fullDomain,
                status: statusOnError, // Use determined status
                error: true,
                errorCategory: category,
                errorMessage: message,
                link: generateLink(fullDomain, statusOnError), // Pass status
                confidenceReasons: ['Check failed due to error.'],
                isParkedByNs: false, // Assume not parked on error
                isParkedByTxt: false // Assume not parked on error
            };
        } finally {
             // Increment processed count *after* the check completes or fails (but not if aborted before starting)
             // Only increment if the promise wasn't aborted prematurely
             if (!signal.aborted) { // Check signal again before incrementing
                 domainsProcessed++;
             }

            // Update overall progress after this domain is done (or errored)
             // Check signal *before* posting progress or result
             if (!signal.aborted) {
                 // Use updateProgress
                 updateProgress(
                     CheckStage.PRIMARY_QUERY,
                     (domainsProcessed / (totalDomains || 1)) * 100, // Update stage progress
                     `Checked ${fullDomain}. (${domainsProcessed}/${totalDomains})`,
                     fullDomain // Keep showing last checked domain briefly
                 );

                 // Send individual result immediately if not null
                 if (result) {
                     self.postMessage({ type: 'single_result', result } as DomainCheckSingleResult);
                     results.push(result); // Add to the final list
                 }
             }
        }
        return result; // Return result or null if aborted
    }));

    // Wait for all primary checks to complete
    const primaryResults = (await Promise.all(checkPromises)).filter(r => r !== null) as DomainResult[];

    // Check if aborted during primary checks
    if (signal.aborted) throw new Error('Aborted during primary checks');

    // --- Placeholder for Confirmation/Fallback Stage ---
    // Example: If you need to re-check available domains
    const availableDomainsToCheck = results // Use 'results' accumulated so far
        .filter(r => r?.status === DomainAvailabilityStatus.AVAILABLE)
        .map(r => r.domain);

    if (availableDomainsToCheck.length > 0) {
        // Use updateProgress
        updateProgress(CheckStage.CONFIRMATION_QUERY, 0, `Starting confirmation checks for ${availableDomainsToCheck.length} potentially available domains...`, null);
        let confirmedDomainsProcessed = 0;
        const totalConfirmationDomains = availableDomainsToCheck.length;

        // Similar loop structure as primary checks, using limiter
        const confirmationPromises = availableDomainsToCheck.map((domainToConfirm) => limiter.add(async () => {
             if (signal.aborted) return null;
             // --- Perform confirmation check logic ---
             // const confirmationResult = await checkDomainAvailability(domainToConfirm, providers, signal, confirmationProgressCallback);
             // --- Update the original result in the 'results' array ---
             // findIndex and update results[index] = confirmationResult;

             // Simulate check
             await new Promise(res => setTimeout(res, 50)); // Simulate network delay

             // Update progress after confirmation check
             confirmedDomainsProcessed++;
              if (!signal.aborted) {
                  // Use updateProgress
                  updateProgress(
                      CheckStage.CONFIRMATION_QUERY,
                      (confirmedDomainsProcessed / (totalConfirmationDomains || 1)) * 100,
                      `Confirmed ${domainToConfirm}. (${confirmedDomainsProcessed}/${totalConfirmationDomains})`,
                      domainToConfirm
                  );
              }
              return domainToConfirm; // Placeholder return
        }));

        await Promise.all(confirmationPromises);
        // Use updateProgress
        updateProgress(CheckStage.CONFIRMATION_QUERY, 100, 'Confirmation checks complete.', null); // Mark stage complete
    }

    // Check if aborted during confirmation
    if (signal.aborted) throw new Error('Aborted during confirmation checks');

    // 4. Analyzing Stage
    // Use updateProgress
    updateProgress(CheckStage.ANALYZING, 0, 'Analyzing results...', null);
    // Perform analysis if needed
    await new Promise(resolve => setTimeout(resolve, 50)); // Simulate analysis time
    // Use updateProgress
    updateProgress(CheckStage.ANALYZING, 100, 'Analysis complete.', null);

    // Check if aborted during analysis
    if (signal.aborted) throw new Error('Aborted during analysis');

    // 5. Finalizing Stage
    // Use updateProgress
    updateProgress(CheckStage.FINALIZING, 0, 'Finalizing and sorting results...', null);
    // Sort results or perform final tasks
    results.sort((a, b) => a.domain.localeCompare(b.domain)); // Example sort
    await new Promise(resolve => setTimeout(resolve, 50)); // Simulate finalization time
    // Use updateProgress
    updateProgress(CheckStage.FINALIZING, 100, 'Finalization complete.', null);

    // Check if aborted just before sending final result
    if (signal.aborted) throw new Error('Aborted before finalizing');

    // 6. Complete
    self.postMessage({
        type: 'progress',
        progressState: {
            percentage: 100,
            stage: CheckStage.COMPLETE,
            domainsProcessed: totalDomains, // Final count
            totalDomains: totalDomains,
            detailedMessage: 'All checks complete!',
            providers: Array.from(activeProviders.entries()).map(([url, active]) => ({ url, active })),
            errors: errorMessages.length > 0 ? [...errorMessages] : undefined,
            retriesAttempted: totalRetries
        }
    } as DomainCheckProgress);

    // Send the final aggregated results (optional if single_result is sufficient)
    // self.postMessage({ type: 'result', results } as DomainCheckResult);

  } catch (error: any) {
     if (error.name === 'AbortError' || error.message?.includes('Aborted')) {
         console.log('Worker: Job aborted cleanly.');
         // Post a cancelled status update using the function
         // Ensure updateProgress is callable here if defined inside try
         // Note: Moved postProgressUpdate outside, so updateProgress wrapper works
         updateProgress(
            CheckStage.CANCELLED,
            0, // Stage progress percent for cancelled
            'Domain check cancelled by user.',
            null // Clear current domain
         );
     } else {
        console.error('Worker: Unhandled error during check:', error);
        const fatalErrorMessage = `Fatal: ${error.message || 'Unknown error'}`;
        errorMessages.push(fatalErrorMessage);

        // Post a general error status update using the function
        // Note: Moved postProgressUpdate outside, so updateProgress wrapper works
        updateProgress(
            CheckStage.ERROR,
            (domainsProcessed / (totalDomains || 1)) * 100, // Use last known progress within stage
            `Worker error: ${error.message || 'Unknown error'}`, // Detailed message
            null // Clear current domain
        );

        // Also send specific error message (remains useful for logging/debugging)
        self.postMessage({ type: 'error', message: `Worker error: ${error.message}` } as DomainCheckError);
     }
  } finally {
      // Clean up the AbortController for this job
      currentAbortController = null;
      console.log('Worker: Job finished or aborted.');
      // Optionally terminate worker if it's meant for single use
      // self.close();
  }
};

// Optional: Add error handler for unexpected worker errors
self.onerror = (event: any) => {
  let errorMessage = 'Uncaught worker error';
  let errorObject: any = null;

  if (event instanceof ErrorEvent) {
    // Standard ErrorEvent
    errorMessage = event.message || errorMessage;
    errorObject = event.error;
    console.error('Worker: Uncaught ErrorEvent:', errorObject, errorMessage);
  } else if (typeof event === 'string') {
    // Sometimes errors might be strings
    errorMessage = event;
    console.error('Worker: Uncaught string error:', errorMessage);
  } else {
    // Other unexpected event type
    console.error('Worker: Uncaught error (unknown type):', event);
    errorMessage = 'Uncaught worker error of unknown type';
    errorObject = event;
  }

  // Attempt to inform the main thread
  try {
    self.postMessage({ type: 'error', message: errorMessage } as DomainCheckError);
  } catch (e) {
    console.error("Worker: Failed to post uncaught error message back to main thread.", e);
  }
};

console.log('Domain Check Worker initialized.'); // Log worker start

// Export empty object for TypeScript module compatibility if needed,
// depending on tsconfig settings for workers. Often not strictly required.
// export {}; 