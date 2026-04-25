import test from 'node:test'
import assert from 'node:assert/strict'

import checkDomainAvailability from '../composables/domain/checker'
import { handleError } from '../composables/domain/dns'
import {
  DNS_RECORD_TYPE_A,
  DNS_RECORD_TYPE_NS,
  DNS_RECORD_TYPE_SOA,
  DNS_RECORD_TYPE_TXT,
  DNS_STATUS_NOERROR,
  DNS_STATUS_NXDOMAIN,
} from '../composables/domain/constants'
import {
  DomainAvailabilityStatus,
  ErrorCategory,
} from '../composables/domain/types'
import { ACTIVE_DOH_PROVIDERS } from '../config/appConfig'
import type { DnsResponse } from '../utils/DohResolver'

interface DnsRequest {
  provider: string
  domain: string
  type: number
}

type MockDnsHandler = (
  request: DnsRequest,
  init?: RequestInit
) => DnsResponse | Error | Promise<DnsResponse | Error>

const activeProviders = ACTIVE_DOH_PROVIDERS.map(provider => ({
  name: provider.name,
  baseUrl: provider.baseUrl,
  headers: provider.headers,
}))

const baseResponse = (status: number, overrides: Partial<DnsResponse> = {}): DnsResponse => ({
  Status: status,
  TC: false,
  RD: true,
  RA: true,
  AD: false,
  CD: false,
  Question: [],
  ...overrides,
})

const exactNsResponse = (domain: string): DnsResponse => baseResponse(DNS_STATUS_NOERROR, {
  Answer: [{
    name: `${domain}.`,
    type: DNS_RECORD_TYPE_NS,
    TTL: 300,
    data: 'ns1.example.net.',
  }],
})

const authorityOnlySoaResponse = (): DnsResponse => baseResponse(DNS_STATUS_NOERROR, {
  Authority: [{
    name: 'test.',
    type: DNS_RECORD_TYPE_SOA,
    TTL: 300,
    data: 'ns1.test. hostmaster.test. 1 7200 3600 1209600 3600',
  }],
})

const timeoutError = (provider = 'https://dns.example/dns-query') =>
  new Error(`DoH request to ${provider} timed out after 2500ms`)

const withMockedFetch = async <T>(handler: MockDnsHandler, run: () => Promise<T>): Promise<T> => {
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const domain = url.searchParams.get('name') || ''
    const type = Number(url.searchParams.get('type'))
    const provider = activeProviders.find(candidate =>
      `${url.origin}${url.pathname}` === candidate.baseUrl
    )?.name || url.hostname

    const response = await handler({ provider, domain, type }, init)

    if (response instanceof Error) {
      throw response
    }

    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {
        get: (name: string) => name.toLowerCase() === 'content-type'
          ? 'application/dns-json'
          : null,
      },
      json: async () => response,
    } as Response
  }) as typeof fetch

  try {
    return await run()
  } finally {
    globalThis.fetch = originalFetch
  }
}

test('returns available when both active providers confirm NXDOMAIN', async () => {
  const requestedTypes: number[] = []

  const result = await withMockedFetch(({ type }) => {
    requestedTypes.push(type)
    return baseResponse(DNS_STATUS_NXDOMAIN)
  }, () => checkDomainAvailability('available-example.test', activeProviders))

  assert.equal(result.status, DomainAvailabilityStatus.AVAILABLE)
  assert.equal(result.error, false)
  assert.equal(requestedTypes.includes(DNS_RECORD_TYPE_TXT), false)
  assert.ok(result.confidenceReasons.some(reason => reason.includes('2/2 NXDOMAIN confirmations')))
})

test('returns indeterminate promptly when one provider times out and one returns NXDOMAIN', async () => {
  const startedAt = performance.now()

  const result = await withMockedFetch(({ provider }) => {
    if (provider === 'Google') {
      return timeoutError()
    }

    return baseResponse(DNS_STATUS_NXDOMAIN)
  }, () => checkDomainAvailability('mixed-timeout.test', activeProviders))

  const durationMs = performance.now() - startedAt

  assert.equal(result.status, DomainAvailabilityStatus.INDETERMINATE)
  assert.equal(result.error, false)
  assert.ok(durationMs < 1000)
})

test('returns registered when exact NS or SOA evidence exists', async () => {
  const domain = 'registered-example.test'

  const result = await withMockedFetch(({ domain: requestedDomain, type }) => {
    if (requestedDomain !== domain) {
      return baseResponse(DNS_STATUS_NXDOMAIN)
    }

    if (type === DNS_RECORD_TYPE_NS || type === DNS_RECORD_TYPE_SOA) {
      return exactNsResponse(domain)
    }

    return baseResponse(DNS_STATUS_NXDOMAIN)
  }, () => checkDomainAvailability(domain, activeProviders))

  assert.equal(result.status, DomainAvailabilityStatus.REGISTERED)
  assert.equal(result.error, false)
})

test('treats NOERROR authority-only SOA/NODATA as indeterminate', async () => {
  const domain = 'nodata-example.test'

  const result = await withMockedFetch(({ domain: requestedDomain, provider, type }) => {
    if (type === DNS_RECORD_TYPE_A || requestedDomain !== domain) {
      return baseResponse(DNS_STATUS_NXDOMAIN)
    }

    if (provider === 'Cloudflare') {
      return authorityOnlySoaResponse()
    }

    return baseResponse(DNS_STATUS_NXDOMAIN)
  }, () => checkDomainAvailability(domain, activeProviders))

  assert.equal(result.status, DomainAvailabilityStatus.INDETERMINATE)
  assert.equal(result.error, false)
})

test('classifies provider health failures without suggesting domain existence', () => {
  const timeout = handleError('timeout', timeoutError(), 'example.test')
  const timeoutAlt = handleError('timeout', new Error('DNS query timeout'), 'example.test')
  const network = handleError('network', new TypeError('fetch failed'), 'example.test')
  const http = handleError('http', new Error('HTTP Error: 503 Service Unavailable'), 'example.test')

  assert.equal(timeout.category, ErrorCategory.TIMEOUT)
  assert.equal(timeout.suggestsDomainExists, false)
  assert.equal(timeoutAlt.category, ErrorCategory.TIMEOUT)
  assert.equal(timeoutAlt.suggestsDomainExists, false)
  assert.equal(network.category, ErrorCategory.NETWORK)
  assert.equal(network.suggestsDomainExists, false)
  assert.equal(http.suggestsDomainExists, false)
})

test('confirmation timeout resolves to indeterminate', async () => {
  const domain = 'confirmation-timeout.test'
  const soaCallsByProvider = new Map<string, number>()

  const result = await withMockedFetch(({ provider, domain: requestedDomain, type }) => {
    if (requestedDomain !== domain) {
      return baseResponse(DNS_STATUS_NXDOMAIN)
    }

    if (type === DNS_RECORD_TYPE_SOA) {
      const count = soaCallsByProvider.get(provider) ?? 0
      soaCallsByProvider.set(provider, count + 1)

      if (provider === 'Google' || count > 0) {
        return timeoutError()
      }
    }

    return baseResponse(DNS_STATUS_NXDOMAIN)
  }, () => checkDomainAvailability(domain, activeProviders))

  assert.equal(result.status, DomainAvailabilityStatus.INDETERMINATE)
  assert.equal(result.error, false)
  assert.ok(result.confidenceReasons.some(reason => reason.includes('Marking as indeterminate')))
})
