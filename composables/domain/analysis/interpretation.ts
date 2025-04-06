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
    const reasons = [...initialReasons]
    let finalStatus: DomainAvailabilityStatus = DomainAvailabilityStatus.INDETERMINATE

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

    if (hasActiveUsageIndicators) {
        finalStatus = DomainAvailabilityStatus.REGISTERED;
        reasons.push("High Confidence: Found active usage indicators (verification TXT records), domain is in use.");
        if (noErrorWithRecordsCount > 0) reasons.push("-> Also confirmed by NS/SOA records.");
        if (hasStrongParkingSignal) reasons.push(`-> Domain also shows parking signals (NS: ${parkedNsCount}, TXT Park: ${parkedTxtConsensusCount}, Wildcard: ${isWildcard}).`);
    }
    else if (noErrorWithRecordsCount > 0) {
        finalStatus = DomainAvailabilityStatus.REGISTERED;
        reasons.push("High Confidence: Found authoritative NS/SOA records, indicating the domain is registered.");
        if (hasStrongParkingSignal) {
            reasons.push(`-> Domain appears potentially parked/premium based on NS/TXT signals. (NS: ${parkedNsCount}, TXT Park: ${parkedTxtConsensusCount}, TXT Premium: ${premiumTxtConsensusCount}, Wildcard: ${isWildcard}). Matched Premium TXT: [${Array.from(uniquePremiumTxtPatterns).join(', ')}]`);
        } else if (hasPremiumTxtSignalConsensus) {
             reasons.push(`-> Premium TXT patterns detected by consensus, potentially indicating a premium domain for sale. Matched TXT: [${Array.from(uniquePremiumTxtPatterns).join(', ')}]`);
        }
    }
    else if (nxDomainCount > 0 && noErrorWithRecordsCount === 0 && servFailCount === 0) {
         if (!isWildcard && nxDomainCount >= distinctProviderResponses) {
            finalStatus = DomainAvailabilityStatus.AVAILABLE;
            reasons.push("High Confidence: All responding providers reported NXDOMAIN (Not Found) without conflicting signals.");
             if (hasPremiumTxtSignalConsensus) {
                 reasons.push(`-> Warning: Domain appears available (NXDOMAIN), but conflicting Premium TXT patterns were detected. Status uncertain. Matched TXT: [${Array.from(uniquePremiumTxtPatterns).join(', ')}]`);
                 finalStatus = DomainAvailabilityStatus.INDETERMINATE;
             }
        } else if (!isWildcard && nxDomainCount > 0 && (nxDomainCount + networkOrTimeoutErrorCount + otherDnsErrorCount) >= distinctProviderResponses) {
             finalStatus = DomainAvailabilityStatus.AVAILABLE;
             reasons.push("Moderate Confidence: At least one provider reported NXDOMAIN with no conflicting registration signals.");
              if (hasPremiumTxtSignalConsensus) {
                 reasons.push(`-> Warning: Domain appears available (NXDOMAIN), but conflicting Premium TXT patterns were detected. Status uncertain. Matched TXT: [${Array.from(uniquePremiumTxtPatterns).join(', ')}]`);
                 finalStatus = DomainAvailabilityStatus.INDETERMINATE;
             }
        } else if (isWildcard) {
            if (hasStrongParkingSignal || hasPremiumTxtSignalConsensus) {
                 finalStatus = DomainAvailabilityStatus.REGISTERED;
                 reasons.push("Low Confidence: NXDOMAIN with wildcard, but strong parking/premium TXT/NS signals suggest it's likely registered/parked.");
                 if (hasPremiumTxtSignalConsensus) reasons.push(`-> Premium TXT patterns detected: [${Array.from(uniquePremiumTxtPatterns).join(', ')}]`);
            } else {
                 finalStatus = DomainAvailabilityStatus.INDETERMINATE;
                 reasons.push("Low Confidence: NXDOMAIN received, but wildcard detection makes status uncertain without parking/premium signals.");
            }
        } else {
             finalStatus = DomainAvailabilityStatus.INDETERMINATE;
             reasons.push("Low Confidence: Mixed results including NXDOMAIN, status uncertain.");
        }
    }
    else if (hasPremiumTxtSignalConsensus && noErrorWithRecordsCount === 0 && nxDomainCount === 0 ) {
         finalStatus = DomainAvailabilityStatus.PREMIUM;
         reasons.push(`Moderate Confidence: Premium status inferred primarily from consensus on specific TXT records indicating domain is for sale/premium. Matched TXT: [${Array.from(uniquePremiumTxtPatterns).join(', ')}]`);
          if (hasStrongParkingSignal && !reasons[reasons.length-1].includes("Parking signals")) {
             reasons.push(`-> Parking signals also detected (NS: ${parkedNsCount}, TXT Park: ${parkedTxtConsensusCount}, Wildcard: ${isWildcard}), supporting premium/reserved classification.`);
         }
    }
    else if (servFailCount > 0 || (totalErrorsSuggestingDomainExists >= consensusThreshold && distinctProviderResponses > 0) || (hasStrongParkingSignal && noErrorWithRecordsCount === 0 && nxDomainCount === 0)) {
        finalStatus = DomainAvailabilityStatus.REGISTERED;
        if (servFailCount > 0) {
            reasons.push("Moderate Confidence: DNS server failures (SERVFAIL) often occur with registered but misconfigured domains.");
        } else if (totalErrorsSuggestingDomainExists >= consensusThreshold) {
            reasons.push("Moderate Confidence: Multiple errors suggesting domain likely exists but has DNS issues.");
        } else {
            reasons.push("Moderate Confidence: Strong parking signals without clear NOERROR/NXDOMAIN suggest domain is registered and parked.");
        }
    }
    else if (noErrorWithoutRecordsCount > 0) {
        finalStatus = DomainAvailabilityStatus.INDETERMINATE;
        reasons.push("Low Confidence: Received NOERROR status but without confirming NS/SOA records. Status uncertain.");
         if (isWildcard) reasons.push("-> Wildcard DNS detected, adding to uncertainty.");
    }
    else if ((networkOrTimeoutErrorCount + otherDnsErrorCount) === totalResponses && totalResponses > 0) {
        finalStatus = DomainAvailabilityStatus.ERROR;
        reasons.push("Error: Failed to get conclusive DNS status due to network issues or server errors.");
    } else {
        finalStatus = DomainAvailabilityStatus.INDETERMINATE;
         reasons.push("Indeterminate: Could not determine a confident status based on mixed or inconclusive results.");
        if ((networkOrTimeoutErrorCount + otherDnsErrorCount + servFailCount) === totalResponses && totalResponses > 0) {
             finalStatus = DomainAvailabilityStatus.ERROR;
        }
    }

    // Generate the link
    const link = generateLink(domain, finalStatus);

    return {
        domain,
        status: finalStatus,
        error: finalStatus === DomainAvailabilityStatus.ERROR,
        errorCategory: finalStatus === DomainAvailabilityStatus.ERROR ? primaryErrorCategory : undefined,
        errorMessage: finalStatus === DomainAvailabilityStatus.ERROR ? primaryErrorMessage : undefined,
        link,
        confidenceReasons: reasons,
        dnssecValidated,
        wildcardDetected: isWildcard || isKnownWildcardTld,
        isParkedByNs: parkedNsCount >= consensusThreshold,
        isParkedByTxt: parkedTxtConsensusCount >= consensusThreshold
    }
} 