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

// --- Worker State ---
let currentWildcardProviderIndex = 0; // Keep track of provider for wildcard checks
let activeProviders = new Map<string, boolean>(); // Track active and failed providers

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
self.onmessage = async (event: MessageEvent<DomainCheckRequest>) => {
  try {
    const { domainName, tlds, concurrencyLimit = 5 } = event.data; // Default to 5 concurrent checks
    currentWildcardProviderIndex = 0; // Reset index for each new batch
    activeProviders = new Map<string, boolean>(); // Reset provider tracking
    const errorMessages: string[] = []; // Track error messages for display in UI

    if (!domainName || !tlds || !Array.isArray(tlds) || tlds.length === 0) {
      self.postMessage({
        type: 'error',
        message: 'Invalid request: domainName and tlds array are required'
      } as DomainCheckError);
      return;
    }

    const results: DomainResult[] = []; // Use DomainResult type
    const totalDomains = tlds.length;
    let domainsProcessed = 0;
    let totalRetries = 0;

    // Initial progress update
    self.postMessage({
      type: 'progress',
      progressState: {
        percentage: 0,
        stage: CheckStage.PREPARING,
        domainsProcessed: 0,
        totalDomains: totalDomains,
        detailedMessage: 'Worker preparing parallel domain checks...',
        currentStageStartTime: Date.now()
      }
    } as DomainCheckProgress);

    // Create a concurrency limiter
    const limiter = new ConcurrencyLimiter(concurrencyLimit);

    // Update progress based on completed domains
    const updateProgress = (increment = 1, additionalState: Partial<ProgressState> = {}) => {
      domainsProcessed += increment;
      const percentage = Math.min(95, (domainsProcessed / totalDomains) * 95);
      
      // Convert provider status map to array
      const providersArray = Array.from(activeProviders.entries()).map(([url, active]) => ({
        url,
        active
      }));
      
      self.postMessage({
        type: 'progress',
        progressState: {
          percentage,
          domainsProcessed,
          totalDomains,
          stage: CheckStage.PRIMARY_QUERY,
          detailedMessage: `Processed ${domainsProcessed} of ${totalDomains} domains`,
          providers: providersArray,
          errors: errorMessages.length > 0 ? [...errorMessages] : undefined,
          retriesAttempted: totalRetries,
          ...additionalState
        }
      } as DomainCheckProgress);
    };

    // Create an async function to check a single domain
    const checkDomain = async (tld: string, index: number): Promise<DomainResult> => {
      const fullDomain = `${domainName}${tld}`;
      
      try {
        // Get the provider URL for this specific wildcard check
        const wildcardProviderUrl = getNextWildcardProviderUrl();
        
        // Update provider status and collect errors
        let domainErrors: string[] = [];
        
        // Send progress update that we're starting this domain
        self.postMessage({
          type: 'progress',
          progressState: {
            currentDomain: fullDomain,
            stage: CheckStage.PREPARING,
            detailedMessage: `Starting check for ${fullDomain}`,
            currentStageStartTime: Date.now(),
            providers: Array.from(activeProviders.entries()).map(([url, active]) => ({
              url,
              active
            }))
          }
        } as DomainCheckProgress);
        
        // Perform the domain check and track current stage
        const result = await checkDomainAvailability(
          fullDomain, 
          [wildcardProviderUrl],
          undefined, // abortSignal
          (progressState: ProgressState) => {
            // Forward detailed progress updates from the domain checker
            self.postMessage({
              type: 'progress',
              progressState: {
                ...progressState,
                currentDomain: fullDomain,
                providers: Array.from(activeProviders.entries()).map(([url, active]) => ({
                  url,
                  active
                }))
              }
            } as DomainCheckProgress);
          }
        );

        // Add any retries from this domain to the total
        if (result.retriesAttempted) {
          totalRetries += result.retriesAttempted;
        }
        
        // Provider is active if we got a result without throwing
        updateProviderStatus(wildcardProviderUrl.baseUrl, true);
        
        // Update progress
        updateProgress();
        
        // Send individual result immediately
        self.postMessage({
          type: 'single_result',
          result
        } as DomainCheckSingleResult);
        
        return result;
      } catch (error) {
        // Handle individual domain errors using the imported handler
        console.error(`Worker: Error checking ${fullDomain}:`, error);
        const { category, message, suggestsDomainExists } = handleError(
          `Worker check for ${fullDomain}`,
          error instanceof Error ? error : new Error(String(error)),
          fullDomain
        );

        // Mark provider as failed
        const wildcardProviderUrl = DOH_PROVIDER_URLS[currentWildcardProviderIndex === 0 ? DOH_PROVIDER_URLS.length - 1 : currentWildcardProviderIndex - 1];
        updateProviderStatus(wildcardProviderUrl, false);
        
        // Determine status based on error type
        const status = suggestsDomainExists ? DomainAvailabilityStatus.REGISTERED : DomainAvailabilityStatus.ERROR;

        // Track error message
        const errorMessage = `Error checking ${fullDomain}: ${message}`;
        // Add to global errors list (limiting to avoid overwhelming the UI)
        if (errorMessages.length < 5) {
          errorMessages.push(errorMessage);
        } else if (errorMessages.length === 5) {
          errorMessages.push('Additional errors occurred...');
        }
        
        // Post specific error message for this domain
        self.postMessage({
          type: 'error',
          message: errorMessage,
          domain: fullDomain
        } as DomainCheckError);

        // Update progress even after an error
        updateProgress(1, {
          errors: [...errorMessages]
        });

        // Create error result
        const errorResult = {
          domain: fullDomain,
          status: status,
          error: status === DomainAvailabilityStatus.ERROR,
          errorCategory: category,
          errorMessage: message,
          link: generateLink(fullDomain, status),
          confidenceReasons: [
            `Worker Error: ${message}`,
            suggestsDomainExists ? 'Error type suggests domain might be registered.' : 'Could not determine status.'
          ],
          dnssecValidated: undefined,
          wildcardDetected: undefined,
          isParkedByNs: false,
          isParkedByTxt: false
        };
        
        // Send individual error result immediately
        self.postMessage({
          type: 'single_result',
          result: errorResult
        } as DomainCheckSingleResult);
        
        // Return error result
        return errorResult;
      }
    };

    // Create an array of promises with concurrency control
    const domainCheckPromises = tlds.map((tld, index) => 
      limiter.add(() => checkDomain(tld, index))
    );

    // Wait for all promises to settle
    const settledPromises = await Promise.allSettled(domainCheckPromises);

    // Process the results
    settledPromises.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        // This should rarely happen as errors are already handled in checkDomain
        const tld = tlds[index];
        const fullDomain = `${domainName}${tld}`;
        console.error(`Unhandled promise rejection for ${fullDomain}:`, result.reason);
        
        // Create a fallback error result
        const errorResult: DomainResult = {
          domain: fullDomain,
          status: DomainAvailabilityStatus.ERROR,
          error: true,
          errorCategory: ErrorCategory.UNKNOWN,
          errorMessage: `Unhandled error: ${result.reason}`,
          link: generateLink(fullDomain, DomainAvailabilityStatus.ERROR),
          confidenceReasons: ['Worker encountered an unhandled promise rejection'],
          dnssecValidated: undefined,
          wildcardDetected: undefined,
          isParkedByNs: false,
          isParkedByTxt: false
        };
        
        results.push(errorResult);
      }
    });

    // Final progress update before sending results
    self.postMessage({
      type: 'progress',
      progressState: {
        percentage: 100,
        stage: CheckStage.COMPLETE,
        domainsProcessed: totalDomains,
        totalDomains: totalDomains,
        detailedMessage: 'All domain checks complete',
        providers: Array.from(activeProviders.entries()).map(([url, active]) => ({
          url,
          active
        })),
        errors: errorMessages.length > 0 ? [...errorMessages] : undefined
      }
    } as DomainCheckProgress);

    // Send final results
    self.postMessage({
      type: 'result',
      results
    } as DomainCheckResult);

  } catch (error) {
    // Handle unexpected global errors in the worker
    console.error("Worker: Global error:", error);
    self.postMessage({
      type: 'error',
      message: `Worker encountered unexpected error: ${error instanceof Error ? error.message : String(error)}`
    } as DomainCheckError);
  }
};

// Export empty object for TypeScript module compatibility if needed,
// depending on tsconfig settings for workers. Often not strictly required.
// export {}; 