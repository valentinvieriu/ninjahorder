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
import { PARKING_NAMESERVERS, analyzeTxtRecordsForParking } from './parking'
import { generateLink } from '../utils'
import type { TxtAnalysisResult } from '../types'

type ProviderResult =
  { status: 'fulfilled', value: DnsResponse, provider: string, queryType: number } |
  { status: 'rejected', reason: Error, provider: string, queryType: number, errorCategory?: ErrorCategory, errorMessage?: string, suggestsDomainExists?: boolean }

type ProviderVote = 'available' | 'registered' | 'indeterminate'

interface ProviderEvidence {
  provider: string
  queryCount: number
  nxDomainCount: number
  noErrorCount: number
  noErrorWithoutExactAnswersCount: number
  servFailCount: number
  otherDnsErrorCount: number
  networkOrTimeoutErrorCount: number
  suggestiveErrorCount: number
  exactAnswerCount: number
  exactNsOrSoaAnswerCount: number
  dnssecValidated: boolean
  parkedByNs: boolean
  txtAnalysis?: TxtAnalysisResult
  hasActiveUsageIndicators: boolean
  hasPremiumSignal: boolean
  hasPositiveExistenceSignal: boolean
  vote: ProviderVote
  partialAvailabilitySignal: boolean
  // True iff at least one query against this provider resulted in a fetch-
  // level rejection (network, timeout, HTTP error). Used by the worker to
  // surface structured per-provider health.
  hasFetchError: boolean
  firstErrorMessage?: string
}

export const normalizeDnsName = (name: string): string => name.toLowerCase().replace(/\.$/, '')

const recordTypeText = (queryType: number): string => {
  if (queryType === DNS_RECORD_TYPE_NS) return 'NS'
  if (queryType === DNS_RECORD_TYPE_SOA) return 'SOA'
  if (queryType === DNS_RECORD_TYPE_TXT) return 'TXT'
  return String(queryType)
}

export const hasExactAnswer = (
  data: DnsResponse,
  domain: string,
  recordTypes?: number[]
): boolean => {
  const normalizedDomain = normalizeDnsName(domain)
  return data.Answer?.some(record => {
    if (normalizeDnsName(record.name) !== normalizedDomain) return false
    return recordTypes ? recordTypes.includes(record.type) : true
  }) ?? false
}

const getEvidence = (providers: Map<string, ProviderEvidence>, provider: string): ProviderEvidence => {
  let evidence = providers.get(provider)
  if (!evidence) {
    evidence = {
      provider,
      queryCount: 0,
      nxDomainCount: 0,
      noErrorCount: 0,
      noErrorWithoutExactAnswersCount: 0,
      servFailCount: 0,
      otherDnsErrorCount: 0,
      networkOrTimeoutErrorCount: 0,
      suggestiveErrorCount: 0,
      exactAnswerCount: 0,
      exactNsOrSoaAnswerCount: 0,
      dnssecValidated: false,
      parkedByNs: false,
      hasActiveUsageIndicators: false,
      hasPremiumSignal: false,
      hasPositiveExistenceSignal: false,
      vote: 'indeterminate',
      partialAvailabilitySignal: false,
      hasFetchError: false,
    }
    providers.set(provider, evidence)
  }

  return evidence
}

/**
 * Analyzes provider responses and extracts provider-level evidence.
 *
 * The important modeling choice here is that each resolver gets one final vote.
 * Multiple query types from the same resolver are sub-signals, not independent
 * consensus.
 */
function analyzeProviderResponses(
  domain: string,
  providerResults: ProviderResult[],
  primaryProviderNames: string[],
  reasons: string[]
) {
  const providerEvidence = new Map<string, ProviderEvidence>()
  const txtAnalysisResults = new Map<string, TxtAnalysisResult>()
  const nsResponses = new Map<string, string[]>()

  let primaryErrorCategory: ErrorCategory | undefined = undefined
  let primaryErrorMessage: string | undefined = undefined
  let dnssecValidated = false
  let parkedNsCount = 0
  let parkedTxtConsensusCount = 0
  let premiumTxtConsensusCount = 0
  let hasActiveUsageIndicators = false
  let totalNxDomainResponses = 0
  let totalServFailResponses = 0
  let totalNoErrorWithExactRecords = 0
  let totalNoErrorWithoutExactRecords = 0
  let totalNetworkOrTimeoutErrors = 0
  let totalOtherDnsErrors = 0
  const uniqueMatchedTxtPatterns = new Set<string>()
  const uniquePremiumTxtPatterns = new Set<string>()

  providerResults.forEach(result => {
    const evidence = getEvidence(providerEvidence, result.provider)
    const queryTypeLabel = recordTypeText(result.queryType)
    const isPrimaryProvider = primaryProviderNames.includes(result.provider)
    evidence.queryCount++

    if (result.status === 'fulfilled') {
      const data = result.value
      const statusText = DNS_STATUS_MESSAGES[data.Status] || `Unknown Status ${data.Status}`
      reasons.push(`Provider ${result.provider}${isPrimaryProvider ? ' (Primary)' : ''} (${queryTypeLabel}): ${statusText}${data.Comment ? ` (${data.Comment})` : ''}`)

      if (data.AD) {
        evidence.dnssecValidated = true
        dnssecValidated = true
        reasons.push(' -> DNSSEC validated (AD flag).')
      }

      if (data.Status === DNS_STATUS_NXDOMAIN) {
        evidence.nxDomainCount++
        totalNxDomainResponses++
        return
      }

      if (data.Status === DNS_STATUS_SERVFAIL) {
        evidence.servFailCount++
        totalServFailResponses++
        if (!primaryErrorCategory) {
          primaryErrorCategory = ErrorCategory.DNS_ERROR
          primaryErrorMessage = `DNS server failure (SERVFAIL) reported by ${result.provider}`
        }
        return
      }

      if (data.Status !== DNS_STATUS_NOERROR) {
        evidence.otherDnsErrorCount++
        totalOtherDnsErrors++
        reasons.push(` -> DNS error code ${data.Status}.`)
        if (!primaryErrorCategory) {
          primaryErrorCategory = ErrorCategory.DNS_ERROR
          primaryErrorMessage = `DNS error ${DNS_STATUS_MESSAGES[data.Status] || data.Status} reported by ${result.provider}`
        }
        return
      }

      evidence.noErrorCount++
      const hasAnyExactAnswer = hasExactAnswer(data, domain)
      const hasExactNsOrSoaAnswer = hasExactAnswer(data, domain, [DNS_RECORD_TYPE_NS, DNS_RECORD_TYPE_SOA])

      if (hasAnyExactAnswer) {
        evidence.exactAnswerCount++
        evidence.hasPositiveExistenceSignal = true
        totalNoErrorWithExactRecords++
        reasons.push(' -> Found exact DNS answer for this domain.')
      } else {
        evidence.noErrorWithoutExactAnswersCount++
        totalNoErrorWithoutExactRecords++
        reasons.push(' -> NOERROR without exact answers; treating as weak/inconclusive evidence.')
      }

      if (hasExactNsOrSoaAnswer) {
        evidence.exactNsOrSoaAnswerCount++
        reasons.push(' -> Found exact NS/SOA delegation or zone-apex evidence.')
      }

      if (result.queryType === DNS_RECORD_TYPE_NS && data.Answer) {
        const currentNsList: string[] = []
        data.Answer.forEach(record => {
          if (record.type !== DNS_RECORD_TYPE_NS || typeof record.data !== 'string') return
          if (normalizeDnsName(record.name) !== normalizeDnsName(domain)) return

          const nameserver = normalizeDnsName(record.data)
          currentNsList.push(nameserver)
          if (PARKING_NAMESERVERS.has(nameserver)) {
            evidence.parkedByNs = true
            reasons.push(` -> Found parking nameserver: ${record.data}`)
          }
        })
        nsResponses.set(result.provider, currentNsList)
      }

      if (result.queryType === DNS_RECORD_TYPE_TXT) {
        const txtAnalysis = analyzeTxtRecordsForParking(data)
        evidence.txtAnalysis = txtAnalysis
        txtAnalysisResults.set(result.provider, txtAnalysis)

        txtAnalysis.matchedPatterns.forEach(pattern => uniqueMatchedTxtPatterns.add(pattern))
        if (txtAnalysis.matchedPatterns.length > 0) {
          reasons.push(` -> Found TXT patterns: [${txtAnalysis.matchedPatterns.join(', ')}] (Confidence: ${txtAnalysis.confidence})`)
        }
        if (txtAnalysis.hasActiveUsageIndicators) {
          evidence.hasActiveUsageIndicators = true
          hasActiveUsageIndicators = true
          evidence.hasPositiveExistenceSignal = true
          reasons.push(' -> Found active domain usage indicators.')
        }
        if (txtAnalysis.isPremium) {
          evidence.hasPremiumSignal = true
          txtAnalysis.matchedPatterns
            .filter(pattern => /premium|sale|broker|purchase|reserved/i.test(pattern))
            .forEach(pattern => uniquePremiumTxtPatterns.add(pattern))
        }
        if (txtAnalysis.isParked || txtAnalysis.isPremium) {
          evidence.hasPositiveExistenceSignal = true
        }
      }

      return
    }

    const category = result.errorCategory || ErrorCategory.UNKNOWN
    const message = result.errorMessage || 'Unknown error'
    reasons.push(`Provider ${result.provider}${isPrimaryProvider ? ' (Primary)' : ''} (${queryTypeLabel}): Error - ${message}`)

    evidence.hasFetchError = true
    if (!evidence.firstErrorMessage) evidence.firstErrorMessage = message

    if (category === ErrorCategory.NETWORK || category === ErrorCategory.TIMEOUT) {
      evidence.networkOrTimeoutErrorCount++
      totalNetworkOrTimeoutErrors++
    } else {
      evidence.otherDnsErrorCount++
      totalOtherDnsErrors++
    }

    if (result.suggestsDomainExists) {
      evidence.suggestiveErrorCount++
      reasons.push(' -> This error type sometimes occurs with registered or DNSSEC-broken domains.')
    }

    if (!primaryErrorCategory) {
      primaryErrorCategory = category
      primaryErrorMessage = message
    }
  })

  providerEvidence.forEach(evidence => {
    if (evidence.parkedByNs) parkedNsCount++
    if (evidence.txtAnalysis?.isParked) parkedTxtConsensusCount++
    if (evidence.txtAnalysis?.isPremium) premiumTxtConsensusCount++

    const hasPositiveSignal =
      evidence.hasPositiveExistenceSignal ||
      evidence.exactNsOrSoaAnswerCount > 0 ||
      evidence.exactAnswerCount > 0 ||
      evidence.parkedByNs ||
      Boolean(evidence.txtAnalysis?.isParked) ||
      Boolean(evidence.txtAnalysis?.isPremium) ||
      evidence.hasActiveUsageIndicators

    if (hasPositiveSignal) {
      evidence.vote = 'registered'
      return
    }

    if (evidence.nxDomainCount > 0 && evidence.servFailCount === 0 && evidence.suggestiveErrorCount === 0) {
      evidence.vote = 'available'
      evidence.partialAvailabilitySignal = evidence.networkOrTimeoutErrorCount > 0 || evidence.otherDnsErrorCount > 0
      return
    }

    evidence.vote = 'indeterminate'
  })

  const evidences = Array.from(providerEvidence.values())
  const distinctProviderResponses = evidences.length
  const consensusThreshold = Math.max(1, Math.ceil(distinctProviderResponses / 2))
  const strictAvailabilityThreshold = distinctProviderResponses >= 2 ? 2 : 1
  const availableProviderVotes = evidences.filter(evidence => evidence.vote === 'available').length
  const registeredProviderVotes = evidences.filter(evidence => evidence.vote === 'registered').length
  const indeterminateProviderVotes = evidences.filter(evidence => evidence.vote === 'indeterminate').length
  const partialAvailabilityVotes = evidences.filter(evidence => evidence.vote === 'available' && evidence.partialAvailabilitySignal).length
  const primaryProviderResults = evidences.filter(evidence => primaryProviderNames.includes(evidence.provider))
  const primaryAvailableVotes = primaryProviderResults.filter(evidence => evidence.vote === 'available').length
  const primaryRegisteredVotes = primaryProviderResults.filter(evidence => evidence.vote === 'registered').length
  const hasPremiumTxtSignalConsensus = premiumTxtConsensusCount >= consensusThreshold && premiumTxtConsensusCount > 0
  const hasStrongParkingSignal =
    parkedNsCount >= consensusThreshold ||
    parkedTxtConsensusCount >= consensusThreshold

  return {
    providerEvidence,
    nxDomainCount: totalNxDomainResponses,
    noErrorWithRecordsCount: totalNoErrorWithExactRecords,
    noErrorWithoutRecordsCount: totalNoErrorWithoutExactRecords,
    servFailCount: totalServFailResponses,
    otherDnsErrorCount: totalOtherDnsErrors,
    networkOrTimeoutErrorCount: totalNetworkOrTimeoutErrors,
    dnssecValidated,
    parkedNsCount,
    txtAnalysisResults,
    primaryErrorCategory,
    primaryErrorMessage,
    hasActiveUsageIndicators,
    processedProviders: new Set(evidences.map(evidence => evidence.provider)),
    nsResponses,
    primaryProviderResults,
    totalResponses: providerResults.length,
    distinctProviderResponses,
    consensusThreshold,
    strictAvailabilityThreshold,
    availableProviderVotes,
    registeredProviderVotes,
    indeterminateProviderVotes,
    partialAvailabilityVotes,
    primaryProviderCount: primaryProviderNames.length,
    primaryProviderResponses: primaryProviderResults.length,
    primaryAvailableVotes,
    primaryRegisteredVotes,
    primaryNxDomainCount: primaryProviderResults.reduce((sum, evidence) => sum + evidence.nxDomainCount, 0),
    primaryNoErrorWithRecordsCount: primaryProviderResults.reduce((sum, evidence) => sum + evidence.exactNsOrSoaAnswerCount, 0),
    primaryNxDomainConsensus: primaryProviderResults.length > 0 && primaryProviderResults.every(evidence => evidence.vote === 'available'),
    anyPrimaryNoErrorWithRecords: primaryProviderResults.some(evidence => evidence.exactNsOrSoaAnswerCount > 0),
    parkedTxtConsensusCount,
    uniqueMatchedTxtPatterns,
    premiumTxtConsensusCount,
    uniquePremiumTxtPatterns,
    hasPremiumTxtSignalConsensus,
    hasStrongParkingSignal
  }
}

/**
 * Calculate availability score based on provider votes, not raw query count.
 */
function calculateAvailabilityScore(
  analysis: ReturnType<typeof analyzeProviderResponses>,
  isWildcard: boolean,
  isKnownWildcardTld: boolean,
  totalErrorsSuggestingDomainExists: number
): number {
  let score = 0

  score += analysis.availableProviderVotes * 30
  score += analysis.primaryAvailableVotes * 10

  if (analysis.availableProviderVotes >= analysis.strictAvailabilityThreshold && analysis.distinctProviderResponses > 1) {
    score += 15
  }

  score -= analysis.registeredProviderVotes * 45
  score -= analysis.indeterminateProviderVotes * 8
  score -= analysis.partialAvailabilityVotes * 8
  score -= analysis.parkedNsCount * 20
  score -= analysis.parkedTxtConsensusCount * 15
  score -= analysis.premiumTxtConsensusCount * 20
  score -= totalErrorsSuggestingDomainExists * 12

  if (analysis.hasActiveUsageIndicators) score -= 60
  if (isWildcard) score -= 35
  if (isKnownWildcardTld) score -= 15

  return score
}

/**
 * Calculate registration score based on provider votes, not raw query count.
 */
function calculateRegistrationScore(
  analysis: ReturnType<typeof analyzeProviderResponses>,
  isWildcard: boolean,
  totalErrorsSuggestingDomainExists: number
): number {
  let score = 0

  score += analysis.registeredProviderVotes * 35
  score += analysis.primaryRegisteredVotes * 15
  score += analysis.servFailCount * 10
  score += analysis.parkedNsCount * 20
  score += analysis.parkedTxtConsensusCount * 15
  score += analysis.premiumTxtConsensusCount * 20
  score += totalErrorsSuggestingDomainExists * 10

  if (analysis.hasActiveUsageIndicators) score += 60
  if (isWildcard) score += 20

  score -= analysis.availableProviderVotes * 15

  return score
}

/**
 * Determine final status and confidence score based on provider-level evidence.
 */
function determineFinalStatusAndScore(
  availabilityScore: number,
  registrationScore: number,
  analysis: ReturnType<typeof analyzeProviderResponses>,
  isWildcard: boolean,
  isKnownWildcardTld: boolean,
  totalErrorsSuggestingDomainExists: number,
  reasons: string[]
): { finalStatus: DomainAvailabilityStatus, confidenceScore: number } {
  let finalStatus = DomainAvailabilityStatus.INDETERMINATE
  let confidenceScore = 0

  const hasBlockingAvailabilityRisk =
    isWildcard ||
    totalErrorsSuggestingDomainExists > 0 ||
    analysis.registeredProviderVotes > 0

  if (analysis.hasPremiumTxtSignalConsensus || (analysis.premiumTxtConsensusCount > 0 && registrationScore >= 35)) {
    finalStatus = DomainAvailabilityStatus.PREMIUM
    confidenceScore = Math.min(90, Math.max(55, registrationScore - availabilityScore / 2))
    reasons.push(`Availability score: ${availabilityScore}, Registration score: ${registrationScore}, Premium signals: ${analysis.premiumTxtConsensusCount}`)
    reasons.push(`Premium status detected based on DNS evidence. Matched patterns: [${Array.from(analysis.uniquePremiumTxtPatterns).join(', ')}]`)
  } else if (analysis.registeredProviderVotes > 0 && registrationScore >= 35) {
    finalStatus = DomainAvailabilityStatus.REGISTERED
    confidenceScore = Math.min(95, Math.max(60, registrationScore - availabilityScore))
    reasons.push(`Availability score: ${availabilityScore}, Registration score: ${registrationScore}`)
    reasons.push(`High confidence: ${analysis.registeredProviderVotes}/${analysis.distinctProviderResponses} resolver(s) reported positive existence evidence.`)
  } else if (
    analysis.availableProviderVotes >= analysis.strictAvailabilityThreshold &&
    availabilityScore > 45 &&
    registrationScore < 25 &&
    !hasBlockingAvailabilityRisk
  ) {
    finalStatus = DomainAvailabilityStatus.PENDING_CONFIRMATION
    confidenceScore = Math.min(90, Math.max(55, availabilityScore - registrationScore))
    reasons.push(`Availability score: ${availabilityScore}, Registration score: ${registrationScore}`)
    reasons.push(`Initial private DNS check suggests availability from ${analysis.availableProviderVotes}/${analysis.distinctProviderResponses} resolver(s). Pending confirmation.`)
  } else {
    finalStatus = DomainAvailabilityStatus.INDETERMINATE
    confidenceScore = Math.max(10, Math.min(65, 50 - Math.abs(availabilityScore - registrationScore) + analysis.availableProviderVotes * 5))
    reasons.push(`Availability score: ${availabilityScore}, Registration score: ${registrationScore}`)
    if (isWildcard) {
      reasons.push('Low confidence: wildcard DNS makes private DNS availability inference unsafe.')
    } else if (isKnownWildcardTld) {
      reasons.push('Low confidence: this TLD is known to produce wildcard or registry-level edge cases.')
    } else {
      reasons.push('Low confidence: mixed or insufficient private DNS signals for a definitive status.')
    }
  }

  return { finalStatus, confidenceScore }
}

/**
 * Interprets the combined results of DNS queries to determine domain availability.
 */
export const interpretCombinedResults = (
  domain: string,
  providerResults: ProviderResult[],
  isWildcard: boolean,
  isKnownWildcardTld: boolean,
  totalErrorsSuggestingDomainExists: number,
  initialReasons: string[],
  primaryProviderNames: string[]
): DomainResult => {
  const reasons = [...initialReasons]

  const analysis = analyzeProviderResponses(domain, providerResults, primaryProviderNames, reasons)

  const availabilityScore = calculateAvailabilityScore(
    analysis,
    isWildcard,
    isKnownWildcardTld,
    totalErrorsSuggestingDomainExists
  )
  const registrationScore = calculateRegistrationScore(
    analysis,
    isWildcard,
    totalErrorsSuggestingDomainExists
  )

  const { finalStatus, confidenceScore } = determineFinalStatusAndScore(
    availabilityScore,
    registrationScore,
    analysis,
    isWildcard,
    isKnownWildcardTld,
    totalErrorsSuggestingDomainExists,
    reasons
  )

  const providerStatuses = Array.from(analysis.providerEvidence.values()).map(evidence => ({
    name: evidence.provider,
    ok: !evidence.hasFetchError,
    errorMessage: evidence.firstErrorMessage,
  }))

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
    isParkedByTxt: analysis.parkedTxtConsensusCount > 0,
    providerStatuses
  }
}
