import test from 'node:test'
import assert from 'node:assert/strict'

import { interpretCombinedResults } from '../composables/domain/analysis/interpretation'
import {
  DNS_RECORD_TYPE_NS,
  DNS_RECORD_TYPE_SOA,
  DNS_RECORD_TYPE_TXT,
  DNS_STATUS_NOERROR,
  DNS_STATUS_NXDOMAIN,
  DNS_STATUS_SERVFAIL,
} from '../composables/domain/constants'
import { DomainAvailabilityStatus } from '../composables/domain/types'
import type { DnsResponse } from '../utils/DohResolver'

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

const fulfilled = (
  provider: string,
  queryType: number,
  value: DnsResponse
) => ({
  status: 'fulfilled' as const,
  provider,
  queryType,
  value,
})

test('requires independent resolver agreement before pending availability', () => {
  const result = interpretCombinedResults(
    'private-example.test',
    [
      fulfilled('Cloudflare', DNS_RECORD_TYPE_NS, baseResponse(DNS_STATUS_NXDOMAIN)),
      fulfilled('Cloudflare', DNS_RECORD_TYPE_SOA, baseResponse(DNS_STATUS_NXDOMAIN)),
      fulfilled('Cloudflare', DNS_RECORD_TYPE_TXT, baseResponse(DNS_STATUS_NXDOMAIN)),
      fulfilled('Google', DNS_RECORD_TYPE_NS, baseResponse(DNS_STATUS_SERVFAIL)),
    ],
    false,
    false,
    0,
    [],
    ['Cloudflare']
  )

  assert.equal(result.status, DomainAvailabilityStatus.INDETERMINATE)
})

test('marks available candidates as pending confirmation when resolvers agree on NXDOMAIN', () => {
  const result = interpretCombinedResults(
    'available-candidate.test',
    [
      fulfilled('Cloudflare', DNS_RECORD_TYPE_NS, baseResponse(DNS_STATUS_NXDOMAIN)),
      fulfilled('Google', DNS_RECORD_TYPE_NS, baseResponse(DNS_STATUS_NXDOMAIN)),
      fulfilled('Quad9', DNS_RECORD_TYPE_NS, baseResponse(DNS_STATUS_NXDOMAIN)),
    ],
    false,
    false,
    0,
    [],
    ['Cloudflare']
  )

  assert.equal(result.status, DomainAvailabilityStatus.PENDING_CONFIRMATION)
})

test('exact NS answers are strong registration evidence', () => {
  const result = interpretCombinedResults(
    'registered.test',
    [
      fulfilled('Cloudflare', DNS_RECORD_TYPE_NS, baseResponse(DNS_STATUS_NOERROR, {
        Answer: [{
          name: 'registered.test.',
          type: DNS_RECORD_TYPE_NS,
          TTL: 300,
          data: 'ns1.example.net.',
        }],
      })),
      fulfilled('Google', DNS_RECORD_TYPE_NS, baseResponse(DNS_STATUS_NOERROR, {
        Answer: [{
          name: 'registered.test.',
          type: DNS_RECORD_TYPE_NS,
          TTL: 300,
          data: 'ns1.example.net.',
        }],
      })),
    ],
    false,
    false,
    0,
    [],
    ['Cloudflare']
  )

  assert.equal(result.status, DomainAvailabilityStatus.REGISTERED)
})

test('NOERROR with authority-only SOA is treated as inconclusive, not registered', () => {
  const result = interpretCombinedResults(
    'nodata.test',
    [
      fulfilled('Cloudflare', DNS_RECORD_TYPE_NS, baseResponse(DNS_STATUS_NOERROR, {
        Authority: [{
          name: 'test.',
          type: DNS_RECORD_TYPE_SOA,
          TTL: 300,
          data: 'ns1.test. hostmaster.test. 1 7200 3600 1209600 3600',
        }],
      })),
      fulfilled('Google', DNS_RECORD_TYPE_NS, baseResponse(DNS_STATUS_NXDOMAIN)),
    ],
    false,
    false,
    0,
    [],
    ['Cloudflare']
  )

  assert.equal(result.status, DomainAvailabilityStatus.INDETERMINATE)
})

test('premium TXT evidence wins over availability-looking noise', () => {
  const result = interpretCombinedResults(
    'premium.test',
    [
      fulfilled('Cloudflare', DNS_RECORD_TYPE_TXT, baseResponse(DNS_STATUS_NOERROR, {
        Answer: [{
          name: 'premium.test.',
          type: DNS_RECORD_TYPE_TXT,
          TTL: 300,
          data: 'premium-domain domain-for-sale',
        }],
      })),
      fulfilled('Google', DNS_RECORD_TYPE_NS, baseResponse(DNS_STATUS_NXDOMAIN)),
    ],
    false,
    false,
    0,
    [],
    ['Cloudflare']
  )

  assert.equal(result.status, DomainAvailabilityStatus.PREMIUM)
})
