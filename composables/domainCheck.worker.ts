/* Domain Check Worker
 * This worker processes domain availability checks in the background,
 * preventing UI freezes when checking multiple domains at once.
 */

// Import from domain module
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

// Simple concurrency limiter implementation for parallel processing
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

// --- Provider Management ---
let providerIndex = 0;

// Helper to get next provider for domain checks
const getNextProvider = (): DohProvider => {
  const providerUrl = DOH_PROVIDER_URLS[providerIndex];
  providerIndex = (providerIndex + 1) % DOH_PROVIDER_URLS.length;
  
  return {
    name: `Provider-${providerIndex}`,
    baseUrl: providerUrl,
  };
};

// --- Main Worker Logic ---
self.onmessage = async (event: MessageEvent<DomainCheckRequest | { type: 'abort' }>) => {
  // Handle abort message
  if (typeof event.data === 'object' && event.data !== null && 'type' in event.data && event.data.type === 'abort') {
    console.log('Worker: Received abort signal.');
    // The abortController is now managed per task - no global abort needed here
    return;
  }

  // Initialize state
  const { domainName, tlds, concurrencyLimit = 5 } = event.data as DomainCheckRequest;
  const results: DomainResult[] = [];
  let domainsProcessed = 0;
  const totalDomains = tlds.length;
  const abortController = new AbortController();
  const signal = abortController.signal;

  // Post progress update to main thread
  const postProgress = (progressState: Partial<ProgressState>) => {
    if (signal.aborted) return;
    
    self.postMessage({ 
      type: 'progress', 
      progressState 
    } as DomainCheckProgress);
  };

  try {
    // Validate input
    if (!domainName || !tlds || !Array.isArray(tlds) || tlds.length === 0) {
      throw new Error('Invalid request: domainName and tlds array are required');
    }

    // Initialize progress
    postProgress({
      percentage: 0,
      stage: CheckStage.PREPARING,
      domainsProcessed: 0,
      totalDomains,
      detailedMessage: `Preparing to check ${totalDomains} domains...`
    });

    // Create concurrency limiter
    const limiter = new ConcurrencyLimiter(concurrencyLimit);
    
    // Process each domain in parallel (but limited by concurrency)
    const checkPromises = tlds.map((tld) => limiter.add(async () => {
      // Check for abort signal
      if (signal.aborted) return null;

      const fullDomain = `${domainName}${tld}`;

      try {
        // Update progress before checking
        postProgress({
          percentage: Math.round((domainsProcessed / totalDomains) * 100),
          stage: CheckStage.PRIMARY_QUERY,
          currentDomain: fullDomain,
          detailedMessage: `Checking ${fullDomain} (${domainsProcessed + 1}/${totalDomains})...`
        });

        // Get a provider for this check
        const provider = getNextProvider();
        
        // Directly use the core domain checking function
        const result = await checkDomainAvailability(
          fullDomain,
          [provider], // Use selected provider
          signal,     // Pass abort signal
          (progress) => {
            // Forward progress updates to main thread, but preserve our counters
            postProgress({
              ...progress,
              domainsProcessed, // Preserve domain count
              totalDomains,     // Preserve total count
              currentDomain: fullDomain
            });
          }
        );

        // Post single result immediately
        if (!signal.aborted) {
          self.postMessage({ 
            type: 'single_result', 
            result 
          } as DomainCheckSingleResult);
        }

        return result;
      } catch (error: any) {
        // Handle domain-specific errors
        if (error.name === 'AbortError' || signal.aborted) {
          return null; // Skip on abort
        }
        
        console.error(`Worker: Error checking ${fullDomain}:`, error);
        
        // Use helper to standardize error handling
        const { category, message, suggestsDomainExists } = handleError(
          `Worker check for ${fullDomain}`,
          error,
          fullDomain
        );
        
        // Determine appropriate status based on error
        const statusOnError = suggestsDomainExists 
          ? DomainAvailabilityStatus.INDETERMINATE 
          : DomainAvailabilityStatus.ERROR;
        
        // Create error result
        const errorResult: DomainResult = {
          domain: fullDomain,
          status: statusOnError,
          error: true,
          errorCategory: category,
          errorMessage: message,
          link: generateLink(fullDomain, statusOnError),
          confidenceReasons: [`Error during check: ${message}`],
          isParkedByNs: false,
          isParkedByTxt: false
        };
        
        // Post single error result
        if (!signal.aborted) {
          self.postMessage({ 
            type: 'single_result', 
            result: errorResult 
          } as DomainCheckSingleResult);
        }
        
        return errorResult;
      } finally {
        // Update counters after each domain (successful or not)
        if (!signal.aborted) {
          domainsProcessed++;
          
          // Update progress after domain check
          postProgress({
            percentage: Math.round((domainsProcessed / totalDomains) * 100),
            stage: domainsProcessed === totalDomains ? CheckStage.FINALIZING : CheckStage.PRIMARY_QUERY,
            domainsProcessed,
            totalDomains,
            detailedMessage: `Processed ${domainsProcessed}/${totalDomains} domains`
          });
        }
      }
    }));

    // Wait for all checks to complete
    const allResults = await Promise.all(checkPromises);
    
    // Filter out null results (from aborted checks)
    const validResults = allResults.filter(result => result !== null) as DomainResult[];
    results.push(...validResults);
    
    // Post completion progress
    postProgress({
      percentage: 100,
      stage: CheckStage.COMPLETE,
      domainsProcessed: totalDomains,
      totalDomains,
      detailedMessage: 'All domain checks complete'
    });
    
    // Post final results for backward compatibility
    self.postMessage({ 
      type: 'result', 
      results 
    } as DomainCheckResult);
    
  } catch (error: any) {
    // Handle worker-level errors
    if (error.name === 'AbortError' || error.message?.includes('Aborted')) {
      // Operation was cancelled
      postProgress({
        percentage: 0,
        stage: CheckStage.CANCELLED,
        domainsProcessed,
        totalDomains,
        detailedMessage: 'Domain check cancelled by user'
      });
    } else {
      // Unexpected error
      console.error('Worker: Unhandled error during domain check:', error);
      
      // Post error progress
      postProgress({
        percentage: Math.round((domainsProcessed / totalDomains) * 100),
        stage: CheckStage.ERROR,
        domainsProcessed,
        totalDomains,
        detailedMessage: `Worker error: ${error.message || 'Unknown error'}`
      });
      
      // Also send specific error message
      self.postMessage({ 
        type: 'error', 
        message: `Worker error: ${error.message || 'Unknown error'}` 
      } as DomainCheckError);
    }
  }
};

// Error handler for unexpected worker errors
self.onerror = (event: any) => {
  let errorMessage = 'Uncaught worker error';
  
  if (event instanceof ErrorEvent) {
    errorMessage = event.message || errorMessage;
  } else if (typeof event === 'string') {
    errorMessage = event;
  }
  
  // Attempt to inform the main thread
  try {
    self.postMessage({ 
      type: 'error', 
      message: errorMessage 
    } as DomainCheckError);
  } catch (e) {
    console.error("Worker: Failed to post uncaught error message.", e);
  }
};

console.log('Domain Check Worker initialized.'); 