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
import { ACTIVE_DOH_PROVIDERS } from '../config/appConfig';

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
const configuredProviders = ACTIVE_DOH_PROVIDERS
  .map(provider => ({
    name: provider.name,
    baseUrl: provider.baseUrl,
    headers: provider.headers,
  }));

// Stable hash of the FQDN, used to pick the primary resolver deterministically
// per-domain. Two checks of the same domain in different sessions produce the
// same primary, which keeps results reproducible. Previously the worker used a
// module-global counter, which made the primary depend on call order.
const hashDomain = (input: string): number => {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
};

const providerHealth = new Map(configuredProviders.map(provider => [provider.baseUrl, true]));

const getProviderProgress = (result?: DomainResult) => {
  if (result) {
    configuredProviders.forEach(provider => {
      const failed = result.confidenceReasons?.some(reason =>
        reason.includes(`Provider ${provider.name}`) &&
        reason.includes('Error -')
      ) ?? false;

      if (failed) {
        providerHealth.set(provider.baseUrl, false);
      }
    });
  }

  return configuredProviders.map(provider => ({
    url: provider.baseUrl,
    name: provider.name,
    active: providerHealth.get(provider.baseUrl) ?? true,
  }));
};

const resetProviderProgress = () => {
  configuredProviders.forEach(provider => {
    providerHealth.set(provider.baseUrl, true);
  });
};

const normalizeDomainProgressStage = (stage: CheckStage) => {
  if (stage === CheckStage.COMPLETE || stage === CheckStage.ERROR) {
    return CheckStage.FINALIZING;
  }

  return stage;
};

// Pick the primary resolver deterministically per-domain. Every active resolver
// is still queried; only the "primary" tiebreaker weight in the interpretation
// layer differs between providers. Determinism makes results reproducible
// across runs of the same domain.
const getOrderedProviders = (domain: string): DohProvider[] => {
  if (configuredProviders.length === 0) return [];
  const primaryIndex = hashDomain(domain) % configuredProviders.length;
  return [
    configuredProviders[primaryIndex],
    ...configuredProviders.filter((_, index) => index !== primaryIndex),
  ];
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
  let domainsProcessed = 0;
  const totalDomains = tlds.length;
  const abortController = new AbortController();
  const signal = abortController.signal;
  resetProviderProgress();

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
      providers: getProviderProgress(),
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
          providers: getProviderProgress(),
          detailedMessage: `Checking ${fullDomain} (${domainsProcessed + 1}/${totalDomains})...`
        });

        // Use all configured providers for real consensus; primary is chosen
        // deterministically per-domain.
        const providers = getOrderedProviders(fullDomain);
        
        // Directly use the core domain checking function
        const result = await checkDomainAvailability(
          fullDomain,
          providers,
          signal,     // Pass abort signal
          (progress) => {
            // Forward progress updates to main thread, but preserve our counters
            postProgress({
              ...progress,
              stage: normalizeDomainProgressStage(progress.stage),
              domainsProcessed, // Preserve domain count
              totalDomains,     // Preserve total count
              providers: progress.providers ?? getProviderProgress(),
              currentDomain: fullDomain
            });
          }
        );

        // Post single result immediately
        if (!signal.aborted) {
          postProgress({
            percentage: Math.round(((domainsProcessed + 1) / totalDomains) * 100),
            stage: CheckStage.FINALIZING,
            domainsProcessed,
            totalDomains,
            currentDomain: fullDomain,
            providers: getProviderProgress(result),
            detailedMessage: `Finished ${fullDomain}`
          });

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
            providers: getProviderProgress(),
            detailedMessage: `Processed ${domainsProcessed}/${totalDomains} domains`
          });
        }
      }
    }));

    // Wait for all checks to complete
    await Promise.all(checkPromises);
    
    // Post completion progress
    postProgress({
      percentage: 100,
      stage: CheckStage.COMPLETE,
      domainsProcessed: totalDomains, // Use totalDomains here as all are processed
      totalDomains,
      providers: getProviderProgress(),
      detailedMessage: 'All domain checks complete'
    });

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
