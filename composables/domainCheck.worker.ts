/* Domain Check Worker
 * This worker processes domain availability checks in the background,
 * preventing UI freezes when checking multiple domains at once.
 */

// Define check steps for more detailed progress reporting
enum CheckStage {
  PREPARING = 'preparing',
  WILDCARD_CHECK = 'wildcard_check',
  PRIMARY_QUERY = 'primary_query',
  FALLBACK_QUERY = 'fallback_query',
  ANALYZING = 'analyzing',
  FINALIZING = 'finalizing',
  COMPLETE = 'complete'
}

// Define the interfaces needed for worker communication
interface DomainCheckRequest {
  domainName: string;
  tlds: string[];
}

interface ProgressState {
  percentage: number;
  currentDomain?: string;
  stage: CheckStage;
  domainsProcessed: number;
  totalDomains: number;
  detailedMessage?: string;
}

interface DomainCheckProgress {
  type: 'progress';
  progressState: Partial<ProgressState>;
  // Keeping these for backwards compatibility
  progress?: number;
  domain?: string;
}

interface DomainCheckResult {
  type: 'result';
  results: any[]; // Will contain the array of DomainResult objects
}

interface DomainCheckError {
  type: 'error';
  message: string;
  domain?: string;
}

// Message handler
self.onmessage = async (event: MessageEvent<DomainCheckRequest>) => {
  try {
    const { domainName, tlds } = event.data;
    
    if (!domainName || !tlds || !Array.isArray(tlds) || tlds.length === 0) {
      self.postMessage({
        type: 'error',
        message: 'Invalid request: domainName and tlds array are required'
      } as DomainCheckError);
      return;
    }
    
    // We'll run the checks sequentially in the worker
    const results: any[] = [];
    const totalDomains = tlds.length;
    
    // Initial progress state
    self.postMessage({
      type: 'progress',
      progressState: {
        percentage: 0,
        stage: CheckStage.PREPARING,
        domainsProcessed: 0,
        totalDomains: totalDomains,
        detailedMessage: 'Preparing domain checks...'
      }
    } as DomainCheckProgress);
    
    // Domain percentage allocation
    const domainPercentage = 100 / totalDomains;
    
    for (let i = 0; i < tlds.length; i++) {
      const tld = tlds[i];
      const fullDomain = `${domainName}${tld}`;
      
      // Update for starting this domain
      self.postMessage({
        type: 'progress',
        progressState: {
          percentage: (i / totalDomains) * 95, // Reserve 5% for finalization
          currentDomain: fullDomain,
          stage: CheckStage.WILDCARD_CHECK,
          domainsProcessed: i,
          totalDomains: totalDomains,
          detailedMessage: `Starting check for ${fullDomain}`
        }
      } as DomainCheckProgress);
      
      try {
        // WILDCARD CHECK PHASE - Update progress for current phase
        self.postMessage({
          type: 'progress',
          progressState: {
            percentage: (i / totalDomains) * 95 + (domainPercentage * 0.2),
            currentDomain: fullDomain,
            stage: CheckStage.WILDCARD_CHECK,
            detailedMessage: `Checking wildcard DNS for ${fullDomain}`
          }
        } as DomainCheckProgress);
        
        // Simulate progress through phases - this should be replaced with actual checking logic
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // PRIMARY QUERY PHASE
        self.postMessage({
          type: 'progress',
          progressState: {
            percentage: (i / totalDomains) * 95 + (domainPercentage * 0.4),
            currentDomain: fullDomain,
            stage: CheckStage.PRIMARY_QUERY,
            detailedMessage: `Querying DNS providers for ${fullDomain}`
          }
        } as DomainCheckProgress);
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // FALLBACK PHASE - May be skipped in real implementation
        self.postMessage({
          type: 'progress',
          progressState: {
            percentage: (i / totalDomains) * 95 + (domainPercentage * 0.6),
            currentDomain: fullDomain,
            stage: CheckStage.FALLBACK_QUERY,
            detailedMessage: `Performing additional DNS checks for ${fullDomain}`
          }
        } as DomainCheckProgress);
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // ANALYSIS PHASE
        self.postMessage({
          type: 'progress',
          progressState: {
            percentage: (i / totalDomains) * 95 + (domainPercentage * 0.8),
            currentDomain: fullDomain,
            stage: CheckStage.ANALYZING,
            detailedMessage: `Analyzing DNS responses for ${fullDomain}`
          }
        } as DomainCheckProgress);
        
        // Note: The worker will import its own checkDomainAvailability function
        // from a separate module that's compatible with web workers
        // For now, simulate the check with a placeholder
        
        // In the actual implementation, this would be:
        // const result = await checkDomainAvailability(fullDomain);
        
        // For now, just send a placeholder message to indicate we need to implement this
        self.postMessage({
          type: 'error',
          message: 'Worker implementation incomplete - checkDomainAvailability needs to be imported and called here',
          domain: fullDomain
        } as DomainCheckError);
        
        // Update progress for completing this domain
        self.postMessage({
          type: 'progress',
          progressState: {
            percentage: (i + 1) / totalDomains * 95,
            domainsProcessed: i + 1,
            currentDomain: fullDomain,
            stage: CheckStage.FINALIZING,
            detailedMessage: `Completed check for ${fullDomain}`
          }
        } as DomainCheckProgress);
        
      } catch (error) {
        // Handle individual domain errors but continue processing
        console.error(`Worker: Error checking ${fullDomain}:`, error);
        
        // Update progress despite error
        self.postMessage({
          type: 'progress',
          progressState: {
            percentage: (i + 1) / totalDomains * 95,
            domainsProcessed: i + 1,
            currentDomain: fullDomain,
            stage: CheckStage.FINALIZING,
            detailedMessage: `Error checking ${fullDomain}`
          }
        } as DomainCheckProgress);
      }
    }
    
    // Final progress update before sending results
    self.postMessage({
      type: 'progress',
      progressState: {
        percentage: 95,
        stage: CheckStage.FINALIZING,
        domainsProcessed: totalDomains,
        totalDomains: totalDomains,
        detailedMessage: 'Finalizing all domain checks...'
      }
    } as DomainCheckProgress);
    
    // Send the final results
    self.postMessage({
      type: 'result',
      results: results
    } as DomainCheckResult);
    
  } catch (error) {
    // Handle any unexpected errors in the worker
    self.postMessage({
      type: 'error',
      message: `Worker error: ${error instanceof Error ? error.message : String(error)}`
    } as DomainCheckError);
  }
};

// Export an empty object to satisfy TypeScript module requirement
export {}; 