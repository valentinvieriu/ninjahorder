import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyRdapVerification,
  buildRdapDomainUrl,
  checkRdapDomain,
  getRdapSupportForRootTlds,
  resetRdapBootstrapCacheForTests,
} from '../composables/domain/rdap'
import { buildDomainCheckCacheKey } from '../composables/domain/cache'
import { DomainAvailabilityStatus, type DomainResult } from '../composables/domain/types'

const bootstrapResponse = (services: Array<[string[], string[]]>) => ({
  version: '1.0',
  services,
})

const jsonResponse = (status: number, body: unknown = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: status === 200 ? 'OK' : String(status),
  headers: {
    get: (name: string) => {
      const lower = name.toLowerCase()
      if (lower === 'content-type') return 'application/rdap+json'
      return null
    },
  },
  json: async () => body,
}) as Response

const withMockedFetch = async <T>(
  handler: (url: string, init?: RequestInit) => Response | Error | Promise<Response | Error>,
  run: () => Promise<T>
): Promise<T> => {
  const originalFetch = globalThis.fetch
  resetRdapBootstrapCacheForTests()

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await handler(String(input), init)
    if (response instanceof Error) throw response
    return response
  }) as typeof fetch

  try {
    return await run()
  } finally {
    resetRdapBootstrapCacheForTests()
    globalThis.fetch = originalFetch
  }
}

const availableResult = (domain = 'example.test'): DomainResult => ({
  domain,
  status: DomainAvailabilityStatus.AVAILABLE,
  error: false,
  link: `https://domainr.com/${domain}`,
  confidenceReasons: ['DNS confirmation supports availability.'],
  isParkedByNs: false,
  isParkedByTxt: false,
})

test('RDAP bootstrap resolves root TLD and builds the domain query URL', async () => {
  const calls: string[] = []

  const result = await withMockedFetch((url) => {
    calls.push(url)

    if (url === 'https://data.iana.org/rdap/dns.json') {
      return jsonResponse(200, bootstrapResponse([
        [['uk'], ['https://rdap.nic.uk/']],
      ]))
    }

    assert.equal(url, 'https://rdap.nic.uk/domain/mybiz.co.uk')
    return jsonResponse(404)
  }, () => checkRdapDomain('mybiz.co.uk'))

  assert.equal(result.status, 'not_found')
  assert.deepEqual(calls, [
    'https://data.iana.org/rdap/dns.json',
    'https://rdap.nic.uk/domain/mybiz.co.uk',
  ])
  assert.equal(buildRdapDomainUrl('https://rdap.example/rdap', 'Example.TEST'), 'https://rdap.example/rdap/domain/example.test')
})

test('RDAP support lookup reports bootstrap-backed TLDs before domain queries', async () => {
  const calls: string[] = []

  const support = await withMockedFetch((url) => {
    calls.push(url)
    assert.equal(url, 'https://data.iana.org/rdap/dns.json')

    return jsonResponse(200, bootstrapResponse([
      [['com', 'net'], ['https://rdap.example/rdap']],
      [['test'], ['http://rdap.test/rdap']],
    ]))
  }, () => getRdapSupportForRootTlds(['.COM', 'unknown', 'test']))

  assert.equal(calls.length, 1)
  assert.equal(support.com.supported, true)
  assert.equal(support.com.baseUrl, 'https://rdap.example/rdap')
  assert.equal(support.test.supported, true)
  assert.equal(support.test.baseUrl, 'http://rdap.test/rdap')
  assert.equal(support.unknown.supported, false)
  assert.match(support.unknown.errorMessage ?? '', /No RDAP bootstrap service/)
})

test('RDAP classifies found, not found, unsupported, rate limited, and network errors', async () => {
  const found = await withMockedFetch((url) => {
    if (url === 'https://data.iana.org/rdap/dns.json') {
      return jsonResponse(200, bootstrapResponse([[['test'], ['https://rdap.example/rdap']]]))
    }

    return jsonResponse(200, {
      objectClassName: 'domain',
      ldhName: 'taken.test',
      status: ['active'],
    })
  }, () => checkRdapDomain('taken.test'))

  assert.equal(found.status, 'found')
  assert.deepEqual(found.domainStatuses, ['active'])

  const missing = await withMockedFetch((url) => {
    if (url === 'https://data.iana.org/rdap/dns.json') {
      return jsonResponse(200, bootstrapResponse([[['test'], ['https://rdap.example/rdap']]]))
    }

    return jsonResponse(404)
  }, () => checkRdapDomain('available.test'))

  assert.equal(missing.status, 'not_found')
  assert.equal(missing.httpStatus, 404)

  const unsupported = await withMockedFetch((url) => {
    assert.equal(url, 'https://data.iana.org/rdap/dns.json')
    return jsonResponse(200, bootstrapResponse([[['com'], ['https://rdap.example/rdap']]]))
  }, () => checkRdapDomain('name.unknown'))

  assert.equal(unsupported.status, 'unsupported')

  const rateLimited = await withMockedFetch((url) => {
    if (url === 'https://data.iana.org/rdap/dns.json') {
      return jsonResponse(200, bootstrapResponse([[['test'], ['https://rdap.example/rdap']]]))
    }

    return jsonResponse(429)
  }, () => checkRdapDomain('limited.test'))

  assert.equal(rateLimited.status, 'rate_limited')
  assert.equal(rateLimited.httpStatus, 429)

  const failed = await withMockedFetch((url) => {
    if (url === 'https://data.iana.org/rdap/dns.json') {
      return jsonResponse(200, bootstrapResponse([[['test'], ['https://rdap.example/rdap']]]))
    }

    return new TypeError('fetch failed')
  }, () => checkRdapDomain('error.test'))

  assert.equal(failed.status, 'error')
  assert.match(failed.errorMessage ?? '', /fetch failed/)
})

test('RDAP verification updates available DNS results conservatively', () => {
  const found = applyRdapVerification(availableResult('taken.test'), {
    status: 'found',
    checkedAt: '2026-04-25T00:00:00.000Z',
    baseUrl: 'https://rdap.example/rdap',
    httpStatus: 200,
  })

  assert.equal(found.status, DomainAvailabilityStatus.REGISTERED)
  assert.ok(found.confidenceReasons.some(reason => reason.includes('RDAP found a registry object')))

  const missing = applyRdapVerification(availableResult('open.test'), {
    status: 'not_found',
    checkedAt: '2026-04-25T00:00:00.000Z',
    baseUrl: 'https://rdap.example/rdap',
    httpStatus: 404,
  })

  assert.equal(missing.status, DomainAvailabilityStatus.AVAILABLE)
  assert.ok(missing.confidenceReasons.some(reason => reason.includes('RDAP did not find a registration object')))

  const failed = applyRdapVerification(availableResult('uncertain.test'), {
    status: 'error',
    checkedAt: '2026-04-25T00:00:00.000Z',
    errorMessage: 'CORS blocked request',
  })

  assert.equal(failed.status, DomainAvailabilityStatus.INDETERMINATE)
  assert.ok(failed.confidenceReasons.some(reason => reason.includes('RDAP verification failed')))
})

test('domain check cache key is DNS-only and independent from RDAP verification', () => {
  const off = buildDomainCheckCacheKey('Example', ['.COM'], false)
  const on = buildDomainCheckCacheKey(' example ', ['.com'], true)

  assert.equal(off.normalizedDomain, 'example')
  assert.deepEqual(off.sortedTLDs, ['.com'])
  assert.equal(off.cacheKey, on.cacheKey)
  assert.equal(off.cacheKey, 'example:.com')
  assert.equal(on.cacheKey, 'example:.com')
})
