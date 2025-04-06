import type { DnsResponse } from '~/utils/DohResolver'
import { 
  DNS_STATUS_NOERROR, 
  DNS_STATUS_NXDOMAIN, 
  DNS_STATUS_SERVFAIL, 
  DNS_RECORD_TYPE_NS, 
  DNS_RECORD_TYPE_SOA, 
  DNS_RECORD_TYPE_TXT,
  DNS_STATUS_MESSAGES
} from '../constants'
import { 
  DomainAvailabilityStatus, 
  ErrorCategory,
  type DomainResult 
} from '../types'
import { PARKING_NAMESERVERS } from './parking'
import { generateLink } from '../utils'
import type { TxtAnalysisResult } from '../types'
import { analyzeTxtRecordsForParking } from './parking'

/**
 * Analyzes provider responses and extracts key metrics and signals
 */
function analyzeProviderResponses(
  providerResults: Array<
    { status: 'fulfilled', value: DnsResponse, provider: string, queryType: number } |
    { status: 'rejected', reason: Error, provider: string, queryType: number, errorCategory?: ErrorCategory, errorMessage?: string, suggestsDomainExists?: boolean }
  >,
  primaryProviderNames: string[],
  reasons: string[],
  isWildcard: boolean
) {
  let nxDomainCount = 0
  let noErrorWithRecordsCount = 0
  let noErrorWithoutRecordsCount = 0
  let servFailCount = 0
  let otherDnsErrorCount = 0
  let networkOrTimeoutErrorCount = 0
  let dnssecValidated = false
  let parkedNsCount = 0
  const txtAnalysisResults = new Map<string, TxtAnalysisResult>()
  let primaryErrorCategory: ErrorCategory | undefined = undefined
  let primaryErrorMessage: string | undefined = undefined
  let hasActiveUsageIndicators = false

  const processedProviders = new Set<string>()
  const nsResponses = new Map<string, string[]>()

  const primaryProviderResults = providerResults.filter(r => primaryProviderNames.includes(r.provider));

  providerResults.forEach(result => {
    processedProviders.add(result.provider)
    const queryTypeText = result.queryType === DNS_RECORD_TYPE_NS ? 'NS' : (result.queryType === DNS_RECORD_TYPE_SOA ? 'SOA' : 'TXT');
    const isPrimaryProvider = primaryProviderNames.includes(result.provider);

    if (result.status === 'fulfilled') {
      const data = result.value
      const statusText = DNS_STATUS_MESSAGES[data.Status] || `Unknown Status ${data.Status}`
      reasons.push(`Provider ${result.provider}${isPrimaryProvider ? ' (Primary)' : ''} (${queryTypeText}): ${statusText}${data.Comment ? ` (${data.Comment})` : ''}`)

      if (data.Status === DNS_STATUS_NXDOMAIN) {
        nxDomainCount++
      } else if (data.Status === DNS_STATUS_NOERROR) {
        const hasNsOrSoaRecords =
          (data.Answer?.some(r => r.type === DNS_RECORD_TYPE_NS || r.type === DNS_RECORD_TYPE_SOA)) ||
          (data.Authority?.some(r => r.type === DNS_RECORD_TYPE_NS || r.type === DNS_RECORD_TYPE_SOA))

        if (hasNsOrSoaRecords) {
          noErrorWithRecordsCount++
          reasons.push(` -> Found NS/SOA records.`)
        } else {
          noErrorWithoutRecordsCount++
          reasons.push(` -> No confirming NS/SOA records found despite NOERROR.`)
        }

        if (result.queryType === DNS_RECORD_TYPE_NS && data.Answer) {
          const currentNsList: string[] = []
          let providerReportsParkedNs = false;
          data.Answer.forEach(record => {
            if (record.type === DNS_RECORD_TYPE_NS && typeof record.data === 'string') {
              const nameserver = record.data.toLowerCase().replace(/\.$/, '');
              currentNsList.push(nameserver);
              if (PARKING_NAMESERVERS.has(nameserver)) {
                providerReportsParkedNs = true;
                reasons.push(` -> Found parking nameserver: ${record.data}`);
              }
            }
          });
          nsResponses.set(result.provider, currentNsList);
          if (providerReportsParkedNs) {
            parkedNsCount++;
          }
        }

        if (result.queryType === DNS_RECORD_TYPE_TXT) {
          const analysis = analyzeTxtRecordsForParking(data);
          txtAnalysisResults.set(result.provider, analysis);
          if (analysis.matchedPatterns.length > 0) {
            reasons.push(` -> Found patterns: [${analysis.matchedPatterns.join(', ')}] (Confidence: ${analysis.confidence})`);
          }
          if (analysis.hasActiveUsageIndicators) {
            hasActiveUsageIndicators = true;
            reasons.push(` -> Found active domain usage indicators (verifications)`);
          }
        }

      } else if (data.Status === DNS_STATUS_SERVFAIL) {
        servFailCount++
        if (!primaryErrorCategory) {
          primaryErrorCategory = ErrorCategory.DNS_ERROR
          primaryErrorMessage = `DNS server failure (SERVFAIL) reported by ${result.provider}`
        }
      } else {
        otherDnsErrorCount++
        reasons.push(` -> DNS error code ${data.Status}.`)
        if (!primaryErrorCategory) {
          primaryErrorCategory = ErrorCategory.DNS_ERROR
          primaryErrorMessage = `DNS error ${DNS_STATUS_MESSAGES[data.Status]} reported by ${result.provider}`
        }
      }

      if (data.AD) {
        dnssecValidated = true
        reasons.push(` -> DNSSEC validated (AD flag).`)
      }
    } else { // status === 'rejected'
      const category = result.errorCategory || ErrorCategory.UNKNOWN
      const message = result.errorMessage || 'Unknown error'
      reasons.push(`Provider ${result.provider}${isPrimaryProvider ? ' (Primary)' : ''} (${queryTypeText}): Error - ${message}`)

      if (category === ErrorCategory.NETWORK || category === ErrorCategory.TIMEOUT) {
        networkOrTimeoutErrorCount++
      } else {
        otherDnsErrorCount++
      }

      if (!primaryErrorCategory) {
        primaryErrorCategory = category
        primaryErrorMessage = message
      }

      if (result.suggestsDomainExists) {
        reasons.push(` -> This error type sometimes occurs with registered domains.`)
      }
    }
  })

  const totalResponses = providerResults.length
  const distinctProviderResponses = processedProviders.size
  const consensusThreshold = Math.max(1, Math.ceil(distinctProviderResponses / 2));

  const primaryProviderCount = primaryProviderNames.length;
  const primaryProviderResponses = primaryProviderResults.length;
  const primaryNxDomainCount = primaryProviderResults.filter(r =>
    r.status === 'fulfilled' && r.value.Status === DNS_STATUS_NXDOMAIN
  ).length;
  const primaryNoErrorWithRecordsCount = primaryProviderResults.filter(r =>
    r.status === 'fulfilled' &&
    r.value.Status === DNS_STATUS_NOERROR &&
    (r.value.Answer?.some(rec => rec.type === DNS_RECORD_TYPE_NS || rec.type === DNS_RECORD_TYPE_SOA) ||
    r.value.Authority?.some(rec => rec.type === DNS_RECORD_TYPE_NS || rec.type === DNS_RECORD_TYPE_SOA))
  ).length;
  const primaryNxDomainConsensus = primaryNxDomainCount === primaryProviderCount && primaryProviderCount > 1;
  const anyPrimaryNoErrorWithRecords = primaryNoErrorWithRecordsCount > 0;

  let parkedTxtConsensusCount = 0;
  let uniqueMatchedTxtPatterns = new Set<string>();
  txtAnalysisResults.forEach(analysis => {
    if (analysis.isParked) parkedTxtConsensusCount++;
    analysis.matchedPatterns.forEach((p: string) => uniqueMatchedTxtPatterns.add(p));
  });

  let premiumTxtConsensusCount = 0;
  let uniquePremiumTxtPatterns = new Set<string>();
  txtAnalysisResults.forEach(analysis => {
    if (analysis.isPremium) {
      premiumTxtConsensusCount++;
      analysis.matchedPatterns.filter((p: string) =>
        p.toLowerCase().includes('premium') ||
        p.toLowerCase().includes('sale') ||
        p.toLowerCase().includes('broker')
      ).forEach((p: string) => uniquePremiumTxtPatterns.add(p));
    }
  });

  const hasPremiumTxtSignalConsensus = premiumTxtConsensusCount >= consensusThreshold && premiumTxtConsensusCount > 0;
  const hasStrongParkingSignal =
    parkedNsCount >= consensusThreshold ||
    parkedTxtConsensusCount >= consensusThreshold ||
    (isWildcard && (parkedNsCount > 0 || parkedTxtConsensusCount > 0));

  return {
    nxDomainCount,
    noErrorWithRecordsCount,
    noErrorWithoutRecordsCount,
    servFailCount,
    otherDnsErrorCount,
    networkOrTimeoutErrorCount,
    dnssecValidated,
    parkedNsCount,
    txtAnalysisResults,
    primaryErrorCategory,
    primaryErrorMessage,
    hasActiveUsageIndicators,
    processedProviders,
    nsResponses,
    primaryProviderResults,
    totalResponses,
    distinctProviderResponses,
    consensusThreshold,
    primaryProviderCount,
    primaryProviderResponses,
    primaryNxDomainCount,
    primaryNoErrorWithRecordsCount,
    primaryNxDomainConsensus,
    anyPrimaryNoErrorWithRecords,
    parkedTxtConsensusCount,
    uniqueMatchedTxtPatterns,
    premiumTxtConsensusCount,
    uniquePremiumTxtPatterns,
    hasPremiumTxtSignalConsensus,
    hasStrongParkingSignal
  };
}

/**
 * Calculate availability score based on various signals
 */
function calculateAvailabilityScore(analysis: ReturnType<typeof analyzeProviderResponses>, isWildcard: boolean): number {
  let score = 0;
  
  // NXDOMAIN responses are strong indicators of availability
  score += analysis.nxDomainCount * 15;
  
  // Primary provider NXDOMAIN carries more weight
  score += analysis.primaryNxDomainCount * 10;
  
  // If all providers return NXDOMAIN, that's a strong signal
  if (analysis.nxDomainCount === analysis.distinctProviderResponses && analysis.distinctProviderResponses > 1) {
    score += 20;
  }
  
  // NOERROR with records is a negative signal for availability
  score -= analysis.noErrorWithRecordsCount * 25;
  
  // Parking signals reduce availability likelihood
  score -= analysis.parkedNsCount * 15;
  score -= analysis.parkedTxtConsensusCount * 10;
  
  // Active usage indicators strongly suggest domain is not available
  if (analysis.hasActiveUsageIndicators) {
    score -= 50;
  }
  
  // Wildcard TLDs make availability harder to determine
  if (isWildcard) {
    score -= 15;
  }
  
  // Premium signals reduce availability likelihood
  score -= analysis.premiumTxtConsensusCount * 15;
  
  return score;
}

/**
 * Calculate registration score based on various signals
 */
function calculateRegistrationScore(analysis: ReturnType<typeof analyzeProviderResponses>, isWildcard: boolean): number {
  let score = 0;
  
  // NOERROR with NS/SOA records is a strong indicator of registration
  score += analysis.noErrorWithRecordsCount * 20;
  
  // Primary provider NOERROR with records carries more weight
  score += analysis.primaryNoErrorWithRecordsCount * 15;
  
  // SERVFAIL often indicates registration with DNSSEC issues
  score += analysis.servFailCount * 10;
  
  // Parking signals strongly suggest registration
  score += analysis.parkedNsCount * 15;
  score += analysis.parkedTxtConsensusCount * 10;
  
  // Active usage indicators strongly suggest domain is registered
  if (analysis.hasActiveUsageIndicators) {
    score += 50;
  }
  
  // Premium signals suggest the domain may be registered and for sale
  score += analysis.premiumTxtConsensusCount * 15;
  
  // NXDOMAIN responses reduce registration likelihood
  score -= analysis.nxDomainCount * 10;
  
  return score;
}

/**
 * Determine final status and confidence score based on availability and registration scores
 */
function determineFinalStatusAndScore(
  availabilityScore: number, 
  registrationScore: number, 
  analysis: ReturnType<typeof analyzeProviderResponses>, 
  isWildcard: boolean,
  reasons: string[]
): { finalStatus: DomainAvailabilityStatus, confidenceScore: number } {
  let finalStatus = DomainAvailabilityStatus.INDETERMINATE;
  let confidenceScore = 0;
  
  if (availabilityScore > 50 && registrationScore < 20) {
    // Strong availability signals with minimal registration signals
    finalStatus = DomainAvailabilityStatus.PENDING_CONFIRMATION; // Changed from AVAILABLE to PENDING_CONFIRMATION
    confidenceScore = Math.min(90, availabilityScore - registrationScore);
    reasons.push(`Availability score: ${availabilityScore}, Registration score: ${registrationScore}`);
    reasons.push("Initial check suggests availability. Pending confirmation.");
  } else if (registrationScore > 50 && availabilityScore < 20) {
    // Strong registration signals with minimal availability signals
    finalStatus = DomainAvailabilityStatus.REGISTERED;
    confidenceScore = Math.min(95, registrationScore - availabilityScore);
    reasons.push(`Availability score: ${availabilityScore}, Registration score: ${registrationScore}`);
    reasons.push("High confidence: Strong registration signals detected.");
  } else if (registrationScore > 40 && analysis.hasPremiumTxtSignalConsensus) {
    // Premium signals with moderate registration score
    finalStatus = DomainAvailabilityStatus.PREMIUM;
    confidenceScore = Math.min(85, registrationScore - availabilityScore/2);
    reasons.push(`Availability score: ${availabilityScore}, Registration score: ${registrationScore}, Premium signals: ${analysis.premiumTxtConsensusCount}`);
    reasons.push(`Premium status detected based on TXT records. Matched patterns: [${Array.from(analysis.uniquePremiumTxtPatterns).join(', ')}]`);
  } else {
    // Conflicting or insufficient signals
    finalStatus = DomainAvailabilityStatus.INDETERMINATE;
    confidenceScore = Math.max(10, 50 - Math.abs(availabilityScore - registrationScore));
    reasons.push(`Availability score: ${availabilityScore}, Registration score: ${registrationScore}`);
    reasons.push("Low confidence: Mixed or insufficient signals for definitive status.");
  }
  
  return { finalStatus, confidenceScore };
}

/**
 * Interprets the combined results of DNS queries to determine domain availability
 */
export const interpretCombinedResults = (
  domain: string,
  providerResults: Array<
    { status: 'fulfilled', value: DnsResponse, provider: string, queryType: number } |
    { status: 'rejected', reason: Error, provider: string, queryType: number, errorCategory?: ErrorCategory, errorMessage?: string, suggestsDomainExists?: boolean }
  >,
  isWildcard: boolean,
  isKnownWildcardTld: boolean,
  totalErrorsSuggestingDomainExists: number,
  initialReasons: string[],
  primaryProviderNames: string[]
): DomainResult => {
  const reasons = [...initialReasons];
  
  // Analyze the raw provider responses
  const analysis = analyzeProviderResponses(providerResults, primaryProviderNames, reasons, isWildcard);
  
  // Calculate scores for availability and registration
  const availabilityScore = calculateAvailabilityScore(analysis, isWildcard);
  const registrationScore = calculateRegistrationScore(analysis, isWildcard);
  
  // Determine final status and confidence score
  const { finalStatus, confidenceScore } = determineFinalStatusAndScore(
    availabilityScore, 
    registrationScore, 
    analysis, 
    isWildcard,
    reasons
  );
  
  return {
    domain,
    status: finalStatus,
    error: false,
    errorCategory: analysis.primaryErrorCategory,
    errorMessage: analysis.primaryErrorMessage,
    link: generateLink(domain, finalStatus),
    confidenceReasons: reasons,
    confidenceScore,
    dnssecValidated: analysis.dnssecValidated,
    wildcardDetected: isWildcard,
    isParkedByNs: analysis.parkedNsCount > 0,
    isParkedByTxt: analysis.parkedTxtConsensusCount > 0
  };
} 