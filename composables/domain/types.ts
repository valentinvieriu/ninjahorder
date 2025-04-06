import type { DnsResponse } from '~/utils/DohResolver'

/**
 * Error categories
 */
export enum ErrorCategory {
  NETWORK = 'NETWORK',
  TIMEOUT = 'TIMEOUT',
  DNS_ERROR = 'DNS_ERROR',
  UNKNOWN = 'UNKNOWN'
}

// Domain availability status
export enum DomainAvailabilityStatus {
  AVAILABLE = 'available',
  REGISTERED = 'registered',
  PREMIUM = 'premium',
  INDETERMINATE = 'indeterminate',
  ERROR = 'error',
  PENDING_CONFIRMATION = 'pending_confirmation'
}

// Domain result interface
export interface DomainResult {
  domain: string
  status: DomainAvailabilityStatus
  error: boolean
  errorCategory?: ErrorCategory
  errorMessage?: string
  link: string
  confidenceReasons: string[]
  confidenceScore?: number
  dnssecValidated?: boolean
  wildcardDetected?: boolean
  isParkedByNs: boolean
  isParkedByTxt: boolean
  retriesAttempted?: number
}

// TXT analysis result interface
export interface TxtAnalysisResult {
  isParked: boolean
  isPremium: boolean
  confidence: number
  matchedPatterns: string[]
  hasActiveUsageIndicators: boolean
}

// Domain check stages
export enum CheckStage {
  PREPARING = 'preparing',
  WILDCARD_CHECK = 'wildcard_check',
  PRIMARY_QUERY = 'primary_query',
  FALLBACK_QUERY = 'fallback_query',
  ANALYZING = 'analyzing',
  CONFIRMATION_QUERY = 'confirmation_query',
  FINALIZING = 'finalizing',
  COMPLETE = 'complete',
  ERROR = 'error',
  CANCELLED = 'cancelled'
}

// Progress state interface
export interface ProgressState {
  percentage: number,
  currentDomain?: string,
  stage: CheckStage,
  domainsProcessed: number,
  totalDomains: number,
  detailedMessage?: string,
  providers?: Array<{ url: string, name?: string, active: boolean }>,
  errors?: string[],
  currentQueryType?: string,
  currentStageStartTime?: number,
  retriesAttempted?: number
}

/**
 * Extended DNS Response including specific application properties
 */
export interface DoHJsonResponse extends DnsResponse {
  // Any additional properties specific to our implementation
} 