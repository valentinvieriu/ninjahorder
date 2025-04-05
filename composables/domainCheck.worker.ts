/* Domain Check Worker
 * This worker processes domain availability checks in the background,
 * preventing UI freezes when checking multiple domains at once.
 */

// Import the core logic, types, and necessary constants
import {
  checkDomainAvailability,
  handleError, // Import error handler
  generateLink, // Import link generator
  DomainAvailabilityStatus, // Import status enum
  ErrorCategory, // Import error category enum
  CheckStage, // Import stage enum
} from './domainCheckerLogic'; // Adjust path if necessary

// Import types - must use type import
import type {
  DomainResult, // Import result type
  ProgressState, // Import progress type
} from './domainCheckerLogic';

// Import constants from config
import { DOH_PROVIDER_URLS } from '../config/appConfig';

// Define the interfaces needed for worker communication based on imported types
interface DomainCheckRequest {
  domainName: string;
  tlds: string[];
  // Optionally receive provider URLs if they can't be imported directly in worker context
  // dohProviderUrls?: string[];
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

interface DomainCheckError {
  type: 'error';
  message: string;
  domain?: string; // Specific domain error
}

// --- Worker State ---
let currentWildcardProviderIndex = 0; // Keep track of provider for wildcard checks

// Helper to get next provider URL for wildcard checks
const getNextWildcardProviderUrl = () => {
    // Use the imported DOH_PROVIDER_URLS
    const providerUrl = DOH_PROVIDER_URLS[currentWildcardProviderIndex];
    currentWildcardProviderIndex = (currentWildcardProviderIndex + 1) % DOH_PROVIDER_URLS.length;
    return providerUrl;
}

// --- Message Handler ---
self.onmessage = async (event: MessageEvent<DomainCheckRequest>) => {
  try {
    const { domainName, tlds } = event.data;
    currentWildcardProviderIndex = 0; // Reset index for each new batch

    if (!domainName || !tlds || !Array.isArray(tlds) || tlds.length === 0) {
      self.postMessage({
        type: 'error',
        message: 'Invalid request: domainName and tlds array are required'
      } as DomainCheckError);
      return;
    }

    const results: DomainResult[] = []; // Use DomainResult type
    const totalDomains = tlds.length;

    // Initial progress update
    self.postMessage({
      type: 'progress',
      progressState: {
        percentage: 0,
        stage: CheckStage.PREPARING,
        domainsProcessed: 0,
        totalDomains: totalDomains,
        detailedMessage: 'Worker preparing domain checks...'
      }
    } as DomainCheckProgress);

    const domainPercentage = 100 / totalDomains;

    for (let i = 0; i < tlds.length; i++) {
      const tld = tlds[i];
      const fullDomain = `${domainName}${tld}`;

      // Update progress for starting this domain
      const currentProgressBase = (i / totalDomains) * 95; // Base percentage for this domain
      self.postMessage({
        type: 'progress',
        progressState: {
          percentage: currentProgressBase,
          currentDomain: fullDomain,
          stage: CheckStage.PREPARING, // Start with preparing stage for this domain
          domainsProcessed: i,
          totalDomains: totalDomains,
          detailedMessage: `Worker starting check for ${fullDomain}`
        }
      } as DomainCheckProgress);

      try {
        // --- No simulation needed, call the actual function ---
        // Get the provider URL for this specific wildcard check
        const wildcardProviderUrl = getNextWildcardProviderUrl();

        // Call the imported check function
        // Note: The checkDomainAvailability function itself handles internal stages
        // like wildcard check, primary query, fallback, analysis.
        // We only signal the start and completion from the worker loop.
        const result = await checkDomainAvailability(fullDomain, wildcardProviderUrl);

        // Add the successful result
        results.push(result);

        // Update progress for completing this domain successfully
        self.postMessage({
          type: 'progress',
          progressState: {
            percentage: ((i + 1) / totalDomains) * 95,
            domainsProcessed: i + 1,
            currentDomain: fullDomain,
            stage: CheckStage.FINALIZING, // Mark as finalizing after completion
            detailedMessage: `Worker completed check for ${fullDomain}`
          }
        } as DomainCheckProgress);

      } catch (error) {
        // Handle individual domain errors using the imported handler
        console.error(`Worker: Error checking ${fullDomain}:`, error);
        const { category, message, suggestsDomainExists } = handleError(
            `Worker check for ${fullDomain}`,
            error as Error,
            fullDomain
        );

        // Determine status based on error type
        const status = suggestsDomainExists ? DomainAvailabilityStatus.REGISTERED : DomainAvailabilityStatus.ERROR;

        // Create an error result object
        const errorResult: DomainResult = {
            domain: fullDomain,
            status: status,
            error: status === DomainAvailabilityStatus.ERROR,
            errorCategory: category,
            errorMessage: message,
            link: generateLink(fullDomain, status), // Use imported generator
            confidenceReasons: [
                `Worker Error: ${message}`,
                suggestsDomainExists ? 'Error type suggests domain might be registered.' : 'Could not determine status.'
            ],
            dnssecValidated: undefined,
            wildcardDetected: undefined, // Could be refined based on specific error context
            isParkedByNs: false,
            isParkedByTxt: false
        };

        // Add the error result to the list
        results.push(errorResult);

        // Post specific error message for this domain
         self.postMessage({
           type: 'error',
           message: `Error checking ${fullDomain}: ${message}`,
           domain: fullDomain // Include domain in error message
         } as DomainCheckError);

        // Update progress even after an error for this domain
        self.postMessage({
          type: 'progress',
          progressState: {
            percentage: ((i + 1) / totalDomains) * 95, // Still increment percentage
            domainsProcessed: i + 1, // Increment processed count
            currentDomain: fullDomain,
            stage: CheckStage.FINALIZING, // Mark as finalizing
            detailedMessage: `Worker encountered error checking ${fullDomain}`
          }
        } as DomainCheckProgress);
      }
    }

    // Final progress update before sending results
    self.postMessage({
      type: 'progress',
      progressState: {
        percentage: 100, // Now set to 100
        stage: CheckStage.COMPLETE,
        domainsProcessed: totalDomains,
        totalDomains: totalDomains,
        detailedMessage: 'Worker finalizing all domain checks...'
      }
    } as DomainCheckProgress);

    // Send the final results array
    self.postMessage({
      type: 'result',
      results: results // Send the array of DomainResult objects
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