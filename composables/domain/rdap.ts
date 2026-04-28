import {
  DomainAvailabilityStatus,
  type DomainResult,
  type RdapVerification,
} from './types'
import { generateLink } from './utils'

const IANA_RDAP_DNS_BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json'

interface RdapBootstrap {
  services?: Array<[string[], string[]]>
}

export interface RdapSupport {
  rootTld: string
  supported: boolean
  baseUrl?: string
  errorMessage?: string
}

interface RdapDomainResponse {
  objectClassName?: string
  ldhName?: string
  unicodeName?: string
  status?: string[]
}

let bootstrapPromise: Promise<RdapBootstrap> | null = null

const nowIso = (): string => new Date().toISOString()

export const getRdapRootTld = (domain: string): string | null => {
  const labels = domain.toLowerCase().replace(/\.$/, '').split('.').filter(Boolean)
  return labels.length > 1 ? labels[labels.length - 1] : null
}

export const resetRdapBootstrapCacheForTests = () => {
  bootstrapPromise = null
}

const fetchBootstrap = async (signal?: AbortSignal): Promise<RdapBootstrap> => {
  if (!bootstrapPromise) {
    bootstrapPromise = fetch(IANA_RDAP_DNS_BOOTSTRAP_URL, {
      headers: { Accept: 'application/json' },
      signal,
    })
      .then(async response => {
        if (!response.ok) {
          throw new Error(`RDAP bootstrap failed with HTTP ${response.status}`)
        }

        return await response.json() as RdapBootstrap
      })
      .catch(error => {
        bootstrapPromise = null
        throw error
      })
  }

  return bootstrapPromise
}

export const resolveRdapBaseUrl = (bootstrap: RdapBootstrap, rootTld: string): string | null => {
  const normalizedTld = rootTld.toLowerCase().replace(/^\.+/, '')

  for (const service of bootstrap.services ?? []) {
    const [tlds, urls] = service
    const hasTld = tlds.some(tld => tld.toLowerCase().replace(/^\.+/, '') === normalizedTld)
    if (!hasTld) continue

    return urls.find(url => url.startsWith('https://')) ?? urls[0] ?? null
  }

  return null
}

export const buildRdapDomainUrl = (baseUrl: string, domain: string): string => {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return `${normalizedBase}domain/${encodeURIComponent(domain.toLowerCase())}`
}

export const getRdapSupportForRootTlds = async (
  rootTlds: string[],
  options: { signal?: AbortSignal } = {}
): Promise<Record<string, RdapSupport>> => {
  const normalizedRootTlds = Array.from(new Set(
    rootTlds
      .map(tld => tld.toLowerCase().replace(/^\.+/, '').trim())
      .filter(Boolean)
  ))

  if (normalizedRootTlds.length === 0) return {}

  try {
    const bootstrap = await fetchBootstrap(options.signal)

    return Object.fromEntries(normalizedRootTlds.map(rootTld => {
      const baseUrl = resolveRdapBaseUrl(bootstrap, rootTld)

      return [
        rootTld,
        {
          rootTld,
          supported: Boolean(baseUrl),
          baseUrl: baseUrl ?? undefined,
          errorMessage: baseUrl ? undefined : `No RDAP bootstrap service found for .${rootTld}.`,
        }
      ]
    }))
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    return Object.fromEntries(normalizedRootTlds.map(rootTld => [
      rootTld,
      {
        rootTld,
        supported: false,
        errorMessage: `RDAP bootstrap unavailable: ${errorMessage}`,
      }
    ]))
  }
}

export const checkRdapDomain = async (
  domain: string,
  options: { signal?: AbortSignal } = {}
): Promise<RdapVerification> => {
  const checkedAt = nowIso()
  const rootTld = getRdapRootTld(domain)

  if (!rootTld) {
    return {
      status: 'unsupported',
      checkedAt,
      errorMessage: 'Domain does not contain a registrable TLD.',
    }
  }

  try {
    const bootstrap = await fetchBootstrap(options.signal)
    const baseUrl = resolveRdapBaseUrl(bootstrap, rootTld)

    if (!baseUrl) {
      return {
        status: 'unsupported',
        checkedAt,
        errorMessage: `No RDAP bootstrap service found for .${rootTld}.`,
      }
    }

    const response = await fetch(buildRdapDomainUrl(baseUrl, domain), {
      headers: { Accept: 'application/rdap+json, application/json' },
      signal: options.signal,
    })

    if (response.status === 404) {
      return {
        status: 'not_found',
        checkedAt,
        baseUrl,
        httpStatus: response.status,
      }
    }

    if (response.status === 429) {
      return {
        status: 'rate_limited',
        checkedAt,
        baseUrl,
        httpStatus: response.status,
        errorMessage: 'RDAP service rate-limited the request.',
      }
    }

    if (!response.ok) {
      return {
        status: 'error',
        checkedAt,
        baseUrl,
        httpStatus: response.status,
        errorMessage: `RDAP query failed with HTTP ${response.status}.`,
      }
    }

    const data = await response.json() as RdapDomainResponse

    return {
      status: 'found',
      checkedAt,
      baseUrl,
      httpStatus: response.status,
      domainStatuses: Array.isArray(data.status) ? data.status : undefined,
    }
  } catch (error) {
    if (options.signal?.aborted) {
      throw error instanceof Error ? error : new Error(String(error))
    }

    return {
      status: 'error',
      checkedAt,
      errorMessage: error instanceof Error ? error.message : String(error),
    }
  }
}

export const applyRdapVerification = (
  result: DomainResult,
  verification: RdapVerification
): DomainResult => {
  let status = result.status
  const confidenceReasons = [...result.confidenceReasons]

  switch (verification.status) {
    case 'found':
      status = DomainAvailabilityStatus.REGISTERED
      confidenceReasons.push('RDAP found a registry object. Marking as registered.')
      break
    case 'not_found':
      status = DomainAvailabilityStatus.AVAILABLE
      confidenceReasons.push('RDAP did not find a registration object. DNS availability signal remains likely; registrar verification is still recommended.')
      break
    case 'unsupported':
      status = DomainAvailabilityStatus.INDETERMINATE
      confidenceReasons.push(`RDAP verification is unsupported for this TLD${verification.errorMessage ? `: ${verification.errorMessage}` : ''}. Marking as indeterminate.`)
      break
    case 'rate_limited':
      status = DomainAvailabilityStatus.INDETERMINATE
      confidenceReasons.push('RDAP verification was rate-limited. Marking as indeterminate.')
      break
    case 'error':
    default:
      status = DomainAvailabilityStatus.INDETERMINATE
      confidenceReasons.push(`RDAP verification failed${verification.errorMessage ? `: ${verification.errorMessage}` : ''}. Marking as indeterminate.`)
      break
  }

  return {
    ...result,
    status,
    link: generateLink(result.domain, status),
    confidenceReasons,
    rdapVerification: verification,
  }
}
