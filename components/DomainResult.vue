<template>
  <div
    class="result-row"
    :class="{ 'animate-pulse-once': isNew }"
  >
    <div class="result-main">
      <div class="status-dot" :class="statusColorClass"></div>
      <div class="domain-block">
        <span class="domain-name">{{ result.domain }}</span>
        <div class="meta-line">
          <span v-if="result.confidenceScore !== undefined">Confidence {{ result.confidenceScore }}</span>
          <span v-if="result.dnssecValidated">DNSSEC AD</span>
          <span v-if="result.wildcardDetected">Wildcard DNS</span>
          <span v-if="result.rdapVerification">RDAP {{ rdapStatusLabel }}</span>
          <span v-else-if="rdapSupportState === 'unsupported'">RDAP unsupported</span>
        </div>
      </div>
    </div>

    <div v-if="isParkedDomain" class="parking-badges">
      <span v-if="result.isParkedByNs">NS Parked</span>
      <span v-if="result.isParkedByTxt">TXT Parked</span>
    </div>

    <div class="result-actions">
      <span class="status-badge" :class="statusBadgeClass">{{ statusText }}</span>
      <span
        v-if="evidenceBadge"
        class="evidence-badge"
        :class="evidenceBadge.variant"
      >
        {{ evidenceBadge.text }}
      </span>

      <button
        v-if="showRdapAction"
        type="button"
        class="rdap-action"
        :disabled="rdapChecking"
        :aria-label="`Verify ${result.domain} with RDAP`"
        @click="emit('verifyRdap', result.domain)"
      >
        {{ rdapChecking ? 'Checking RDAP' : 'Verify RDAP' }}
      </button>

      <div class="info-wrap">
        <button type="button" class="info-button" aria-label="Show DNS evidence">
          i
        </button>

        <div class="evidence-tooltip">
          <div class="tooltip-header">
            <strong>{{ result.domain }}</strong>
            <span class="status-badge compact" :class="statusBadgeClass">{{ tooltipStatusText }}</span>
          </div>

          <div class="decision-card" :class="decisionSummary.variant">
            <span>Why this status</span>
            <strong>{{ decisionSummary.status }}</strong>
            <p>{{ decisionSummary.reason }}</p>
          </div>

          <div class="metric-grid">
            <div class="metric-card" :class="metricCardClass('dnssec')">
              <span>DNSSEC</span>
              <strong>{{ result.dnssecValidated ? 'Validated' : 'Not validated' }}</strong>
              <small v-if="decisionSignal === 'dnssec'">Deciding evidence</small>
            </div>
            <div class="metric-card" :class="metricCardClass('wildcard')">
              <span>Wildcard</span>
              <strong>{{ result.wildcardDetected ? 'Detected' : 'Not detected' }}</strong>
              <small v-if="decisionSignal === 'wildcard'">Deciding evidence</small>
            </div>
            <div class="metric-card" :class="metricCardClass('parking')">
              <span>Parking</span>
              <strong>{{ isParkedDomain ? parkingType : 'Not detected' }}</strong>
              <small v-if="decisionSignal === 'parking'">Deciding evidence</small>
            </div>
            <div class="metric-card" :class="metricCardClass('rdap')">
              <span>RDAP</span>
              <strong>{{ rdapMetricText }}</strong>
              <small v-if="decisionSignal === 'rdap'">Deciding evidence</small>
            </div>
          </div>

          <div v-if="result.confidenceReasons.length > 0" class="reason-list">
            <div class="tooltip-section-title">Analysis steps</div>
            <div
              v-for="(reason, index) in formattedReasons"
              :key="index"
              class="reason-item"
              :class="{ sub: reason.isSubItem, positive: reason.isPositive, negative: reason.isNegative }"
            >
              <span class="reason-dot"></span>
              <p>{{ reason.text }}</p>
            </div>
          </div>

          <div class="tooltip-footer">
            Action opens {{ domainLinkHost }}.
          </div>
        </div>
      </div>

      <a
        :href="domainLink"
        target="_blank"
        rel="noopener noreferrer"
        class="action-link"
        :class="{ muted: result.status === 'error' || result.status === 'indeterminate' }"
      >
        {{ buttonText }}
      </a>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { DomainAvailabilityStatus } from '~/composables/useDomainCheck'

type RdapSupportState = 'checking' | 'supported' | 'unsupported' | 'unknown'

const props = defineProps<{
  rdapChecking?: boolean
  rdapSupportState?: RdapSupportState
  showRdapAction?: boolean
  result: {
    domain: string
    status: DomainAvailabilityStatus
    error: boolean
    errorMessage?: string
    link: string
    confidenceReasons: string[]
    confidenceScore?: number
    dnssecValidated?: boolean
    wildcardDetected?: boolean
    isParkedByNs: boolean
    isParkedByTxt: boolean
    rdapVerification?: {
      status: string
      checkedAt: string
      baseUrl?: string
      httpStatus?: number
      errorMessage?: string
      domainStatuses?: string[]
    }
  }
}>()

const emit = defineEmits<{
  verifyRdap: [domain: string]
}>()

const isNew = ref(true)

onMounted(() => {
  setTimeout(() => {
    isNew.value = false
  }, 1500)
})

const isParkedDomain = computed(() => {
  return props.result.isParkedByNs || props.result.isParkedByTxt
})

const parkingType = computed(() => {
  if (props.result.isParkedByNs && props.result.isParkedByTxt) return 'NS and TXT'
  if (props.result.isParkedByNs) return 'NS'
  if (props.result.isParkedByTxt) return 'TXT'
  return 'None'
})

const rdapStatusLabel = computed(() => {
  switch (props.result.rdapVerification?.status) {
    case 'found':
      return 'Found'
    case 'not_found':
      return 'Not found'
    case 'unsupported':
      return 'Unsupported'
    case 'rate_limited':
      return 'Rate limited'
    case 'error':
      return 'Error'
    default:
      return 'Not checked'
  }
})

const rdapMetricText = computed(() => {
  if (props.result.rdapVerification) return rdapStatusLabel.value

  switch (props.rdapSupportState) {
    case 'checking':
      return 'Checking support'
    case 'supported':
      return 'Supported, not checked'
    case 'unsupported':
      return 'Not supported for this TLD'
    case 'unknown':
    default:
      return 'Not checked'
  }
})

const domainLink = computed(() => {
  if (isParkedDomain.value && props.result.status === DomainAvailabilityStatus.REGISTERED) {
    return `https://domainr.com/${props.result.domain}`
  }
  return props.result.link
})

const domainLinkHost = computed(() => {
  try {
    const url = new URL(domainLink.value)
    return url.hostname
  } catch (e) {
    return domainLink.value
  }
})

const statusColorClass = computed(() => {
  switch (props.result.status) {
    case DomainAvailabilityStatus.AVAILABLE:
      return 'available'
    case DomainAvailabilityStatus.REGISTERED:
      return isParkedDomain.value ? 'parked' : 'registered'
    case DomainAvailabilityStatus.PREMIUM:
      return 'premium'
    case DomainAvailabilityStatus.INDETERMINATE:
      return 'indeterminate'
    case DomainAvailabilityStatus.ERROR:
    default:
      return 'error'
  }
})

const statusBadgeClass = computed(() => statusColorClass.value)

const statusText = computed(() => {
  if (
    props.result.status === DomainAvailabilityStatus.REGISTERED &&
    props.result.rdapVerification?.status === 'found'
  ) {
    return 'Registered via RDAP'
  }

  if (props.result.status === DomainAvailabilityStatus.REGISTERED && isParkedDomain.value) {
    return 'Registered Parked'
  }

  switch (props.result.status) {
    case DomainAvailabilityStatus.AVAILABLE:
      return 'Likely Available'
    case DomainAvailabilityStatus.REGISTERED:
      return 'Registered'
    case DomainAvailabilityStatus.PREMIUM:
      return 'Premium Signal'
    case DomainAvailabilityStatus.INDETERMINATE:
      return 'Indeterminate'
    case DomainAvailabilityStatus.ERROR:
      return 'Error'
    default:
      return 'Unknown'
  }
})

const tooltipStatusText = computed(() => {
  switch (props.result.rdapVerification?.status) {
    case 'found':
      return 'Registered via RDAP'
    case 'not_found':
      return 'Likely Available - RDAP not found'
    case 'unsupported':
      return 'Needs review - RDAP unsupported'
    case 'rate_limited':
      return 'Needs review - RDAP rate limited'
    case 'error':
      return 'Needs review - RDAP error'
  }

  if (props.result.status === DomainAvailabilityStatus.AVAILABLE) {
    if (props.rdapSupportState === 'unsupported') {
      return 'Likely Available - DNS only'
    }

    if (props.rdapSupportState === 'supported') {
      return 'Likely Available - RDAP available'
    }
  }

  if (props.result.status === DomainAvailabilityStatus.REGISTERED) {
    if (isParkedDomain.value) {
      return `Registered - parked ${parkingType.value} evidence`
    }

    return 'Registered - DNS evidence'
  }

  if (props.result.status === DomainAvailabilityStatus.PREMIUM) {
    return 'Premium - DNS/TXT signal'
  }

  if (props.result.status === DomainAvailabilityStatus.INDETERMINATE) {
    return 'Needs review - DNS inconclusive'
  }

  return statusText.value
})

const decisionSummary = computed(() => {
  switch (props.result.rdapVerification?.status) {
    case 'found':
      return {
        status: 'Registered',
        reason: 'RDAP found a registry object. This is the evidence that changes the domain to registered.',
        variant: 'rdap-registered',
        signal: 'rdap',
      }
    case 'not_found':
      return {
        status: 'Likely Available',
        reason: 'RDAP returned no registration object, so it supports the DNS availability signal.',
        variant: 'rdap-clear',
        signal: 'rdap',
      }
    case 'unsupported':
      return {
        status: 'Needs review',
        reason: 'RDAP is unsupported for this TLD.',
        variant: 'needs-review',
        signal: 'rdap',
      }
    case 'rate_limited':
      return {
        status: 'Needs review',
        reason: 'The RDAP service rate-limited the lookup.',
        variant: 'needs-review',
        signal: 'rdap',
      }
    case 'error':
      return {
        status: 'Needs review',
        reason: 'The RDAP lookup failed.',
        variant: 'needs-review',
        signal: 'rdap',
      }
  }

  if (props.result.status === DomainAvailabilityStatus.REGISTERED) {
    if (isParkedDomain.value) {
      return {
        status: 'Registered',
        reason: `Parking evidence was detected from ${parkingType.value} records. That is the strongest registration signal.`,
        variant: 'dns-registered',
        signal: 'parking',
      }
    }

    if (props.result.wildcardDetected) {
      return {
        status: 'Registered',
        reason: 'Wildcard DNS answers were detected. That makes the DNS result unsafe to treat as available.',
        variant: 'dns-registered',
        signal: 'wildcard',
      }
    }

    return {
      status: 'Registered',
      reason: 'DNS returned exact-domain existence evidence, such as NS, SOA, or record data.',
      variant: 'dns-registered',
      signal: 'dns',
    }
  }

  if (props.result.status === DomainAvailabilityStatus.AVAILABLE) {
    if (props.rdapSupportState === 'unsupported') {
      return {
        status: 'Likely Available',
        reason: 'DNS suggests availability; RDAP is not supported for this TLD.',
        variant: 'dns-only',
        signal: 'dns',
      }
    }

    if (props.result.rdapVerification?.status === 'not_found') {
      return {
        status: 'Likely Available',
        reason: 'DNS and RDAP both support the availability signal.',
        variant: 'rdap-clear',
        signal: 'rdap',
      }
    }

    return {
      status: 'Likely Available',
      reason: 'DNS returned NXDOMAIN consensus.',
      variant: 'dns-available',
      signal: 'dns',
    }
  }

  if (props.result.status === DomainAvailabilityStatus.PREMIUM) {
    return {
      status: 'Premium Signal',
      reason: 'DNS records contain premium or sales signals.',
      variant: 'needs-review',
      signal: 'dns',
    }
  }

  if (props.result.status === DomainAvailabilityStatus.INDETERMINATE) {
    return {
      status: 'Needs review',
      reason: 'DNS evidence was incomplete or conflicted.',
      variant: 'needs-review',
      signal: 'dns',
    }
  }

  return {
    status: 'Error',
    reason: props.result.errorMessage || 'The check failed before a reliable decision could be made.',
    variant: 'needs-review',
    signal: 'dns',
  }
})

const decisionSignal = computed(() => decisionSummary.value.signal)

const metricCardClass = (signal: string) => {
  if (decisionSignal.value !== signal) return {}

  return {
    decisive: true,
    [decisionSummary.value.variant]: true,
  }
}

const evidenceBadge = computed(() => {
  switch (props.result.rdapVerification?.status) {
    case 'found':
      return { text: 'RDAP found', variant: 'registered' }
    case 'not_found':
      return { text: 'RDAP clear', variant: 'verified' }
    case 'unsupported':
      return { text: 'RDAP unsupported', variant: 'unsupported' }
    case 'rate_limited':
      return { text: 'RDAP rate limit', variant: 'warning' }
    case 'error':
      return { text: 'RDAP error', variant: 'warning' }
  }

  if (
    props.result.status === DomainAvailabilityStatus.AVAILABLE &&
    props.rdapSupportState === 'unsupported'
  ) {
    return { text: 'DNS only', variant: 'unsupported' }
  }

  if (props.result.status === DomainAvailabilityStatus.REGISTERED) {
    if (isParkedDomain.value) {
      return { text: 'Parked DNS', variant: 'warning' }
    }

    return { text: 'DNS found', variant: 'registered' }
  }

  if (props.result.status === DomainAvailabilityStatus.PREMIUM) {
    return { text: 'Premium signal', variant: 'warning' }
  }

  if (props.result.status === DomainAvailabilityStatus.INDETERMINATE) {
    return { text: 'Needs review', variant: 'warning' }
  }

  return null
})

const formattedReasons = computed(() => {
  return props.result.confidenceReasons.map(reason => {
    const isSubItem = reason.trim().startsWith('->') || reason.trim().startsWith(' ->')
    const text = isSubItem ? reason.replace(/^->\s*/, '') : reason

    const lower = text.toLowerCase()
    const isPositive = !isSubItem && (
      lower.includes('available') ||
      lower.includes('nxdomain') ||
      lower.includes('confirmation check supports')
    )

    const isNegative = !isSubItem && (
      lower.includes('registered') ||
      lower.includes('ns/soa') ||
      lower.includes('parking') ||
      lower.includes('premium') ||
      lower.includes('error') ||
      lower.includes('indeterminate')
    )

    return { text, isSubItem, isPositive, isNegative }
  })
})

const buttonText = computed(() => {
  if (props.result.status === DomainAvailabilityStatus.REGISTERED && isParkedDomain.value) {
    return 'Details'
  }

  switch (props.result.status) {
    case DomainAvailabilityStatus.AVAILABLE:
      return 'Register'
    case DomainAvailabilityStatus.REGISTERED:
      return 'Visit'
    case DomainAvailabilityStatus.PREMIUM:
      return 'Purchase'
    case DomainAvailabilityStatus.INDETERMINATE:
      return 'Check'
    case DomainAvailabilityStatus.ERROR:
    default:
      return 'Details'
  }
})
</script>

<style scoped>
.result-row {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 12px;
  align-items: center;
  min-height: 72px;
  margin-bottom: 9px;
  padding: 12px;
  border: 1px solid oklch(100% 0 0 / 0.19);
  border-radius: var(--nh-radius);
  background:
    linear-gradient(145deg, oklch(100% 0 0 / 0.13), oklch(100% 0 0 / 0.06)),
    oklch(100% 0 0 / 0.08);
  box-shadow: 0 12px 36px oklch(5% 0.035 260 / 0.22), inset 0 1px 0 oklch(100% 0 0 / 0.18);
  backdrop-filter: blur(18px) saturate(1.32);
  -webkit-backdrop-filter: blur(18px) saturate(1.32);
}

.result-row:hover,
.result-row:focus-within {
  z-index: 45;
}

.result-main {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 11px;
}

.status-dot {
  width: 12px;
  height: 12px;
  flex: 0 0 auto;
  border-radius: 50%;
  box-shadow: 0 0 18px currentColor;
}

.status-dot.available { color: var(--nh-lime); background: var(--nh-lime); }
.status-dot.registered { color: var(--nh-rose); background: var(--nh-rose); }
.status-dot.parked { color: var(--nh-amber); background: var(--nh-amber); }
.status-dot.premium { color: var(--nh-violet); background: var(--nh-violet); }
.status-dot.indeterminate { color: var(--nh-amber); background: var(--nh-amber); }
.status-dot.error { color: oklch(72% 0.02 250); background: oklch(72% 0.02 250); }

.domain-block {
  min-width: 0;
}

.domain-name {
  display: block;
  color: var(--nh-text);
  font-size: 1.02rem;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.meta-line {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  min-height: 18px;
  margin-top: 2px;
}

.meta-line span,
.parking-badges span {
  color: oklch(84% 0.04 245 / 0.82);
  font-size: 0.72rem;
  font-weight: 600;
}

.parking-badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.parking-badges span {
  padding: 5px 8px;
  border: 1px solid oklch(82% 0.16 78 / 0.36);
  border-radius: 999px;
  color: oklch(90% 0.10 78);
  background: oklch(82% 0.16 78 / 0.11);
}

.result-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.status-badge,
.action-link,
.evidence-badge,
.rdap-action,
.info-button {
  min-height: 32px;
  border-radius: var(--nh-radius);
  font-size: 0.76rem;
  font-weight: 700;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  padding: 0 9px;
  border: 1px solid oklch(100% 0 0 / 0.18);
  white-space: nowrap;
}

.status-badge.compact {
  min-height: 24px;
  font-size: 0.7rem;
}

.tooltip-header .status-badge.compact {
  justify-content: center;
  max-width: 190px;
  white-space: normal;
  text-align: center;
}

.evidence-badge {
  display: inline-flex;
  align-items: center;
  padding: 0 9px;
  border: 1px solid oklch(100% 0 0 / 0.16);
  color: oklch(84% 0.04 245 / 0.86);
  background: oklch(100% 0 0 / 0.07);
  white-space: nowrap;
}

.evidence-badge.verified {
  color: oklch(92% 0.10 142);
  border-color: oklch(82% 0.17 142 / 0.30);
  background: oklch(82% 0.17 142 / 0.10);
}

.evidence-badge.registered,
.evidence-badge.warning {
  color: oklch(91% 0.11 78);
  border-color: oklch(82% 0.16 78 / 0.34);
  background: oklch(82% 0.16 78 / 0.11);
}

.evidence-badge.unsupported {
  color: oklch(86% 0.04 245);
  border-color: oklch(100% 0 0 / 0.18);
  background: oklch(100% 0 0 / 0.08);
}

.status-badge.available { color: oklch(90% 0.12 142); background: oklch(82% 0.17 142 / 0.12); border-color: oklch(82% 0.17 142 / 0.34); }
.status-badge.registered { color: oklch(89% 0.11 25); background: oklch(69% 0.19 25 / 0.12); border-color: oklch(69% 0.19 25 / 0.34); }
.status-badge.parked { color: oklch(91% 0.11 78); background: oklch(82% 0.16 78 / 0.12); border-color: oklch(82% 0.16 78 / 0.34); }
.status-badge.premium { color: oklch(90% 0.09 300); background: oklch(72% 0.18 300 / 0.13); border-color: oklch(72% 0.18 300 / 0.34); }
.status-badge.indeterminate { color: oklch(91% 0.11 78); background: oklch(82% 0.16 78 / 0.12); border-color: oklch(82% 0.16 78 / 0.34); }
.status-badge.error { color: oklch(87% 0.03 245); background: oklch(72% 0.02 250 / 0.12); border-color: oklch(100% 0 0 / 0.16); }

.info-wrap {
  position: relative;
}

.info-button {
  width: 32px;
  border: 1px solid oklch(100% 0 0 / 0.18);
  color: var(--nh-text);
  background: oklch(100% 0 0 / 0.08);
  line-height: 1;
}

.info-button:hover {
  background: oklch(100% 0 0 / 0.15);
}

.rdap-action {
  padding: 0 10px;
  border: 1px solid oklch(82% 0.16 78 / 0.38);
  color: oklch(91% 0.11 78);
  background: oklch(82% 0.16 78 / 0.10);
  white-space: nowrap;
}

.rdap-action:hover:not(:disabled) {
  color: var(--nh-text);
  border-color: oklch(82% 0.16 78 / 0.58);
  background: oklch(82% 0.16 78 / 0.16);
}

.rdap-action:disabled {
  cursor: wait;
  opacity: 0.64;
}

.evidence-tooltip {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  z-index: 40;
  width: min(440px, calc(100vw - 32px));
  max-height: min(520px, 75vh);
  padding: 13px;
  overflow-y: auto;
  transform: scale(0.98);
  transform-origin: top right;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  border: 1px solid oklch(100% 0 0 / 0.22);
  border-radius: var(--nh-radius);
  color: var(--nh-text);
  background:
    linear-gradient(145deg, oklch(25% 0.055 260 / 0.88), oklch(14% 0.045 255 / 0.92));
  box-shadow: 0 24px 70px oklch(4% 0.035 260 / 0.55), inset 0 1px 0 oklch(100% 0 0 / 0.18);
  backdrop-filter: blur(24px) saturate(1.25);
  -webkit-backdrop-filter: blur(24px) saturate(1.25);
  transition: opacity 160ms ease, transform 160ms ease, visibility 160ms ease;
}

.info-wrap:hover .evidence-tooltip,
.info-wrap:focus-within .evidence-tooltip {
  opacity: 1;
  visibility: visible;
  transform: scale(1);
  pointer-events: auto;
}

.tooltip-header {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
  padding-bottom: 10px;
  border-bottom: 1px solid oklch(100% 0 0 / 0.13);
}

.tooltip-header strong {
  min-width: 0;
  overflow-wrap: anywhere;
}

.decision-card {
  margin-top: 10px;
  padding: 12px;
  border: 1px solid oklch(100% 0 0 / 0.16);
  border-radius: var(--nh-radius);
  background: oklch(100% 0 0 / 0.07);
}

.decision-card span {
  display: block;
  color: oklch(82% 0.04 245 / 0.76);
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
}

.decision-card strong {
  display: block;
  margin-top: 3px;
  color: var(--nh-text);
  font-size: 1rem;
}

.decision-card p {
  margin: 6px 0 0;
  color: oklch(94% 0.02 245);
  font-size: 0.8rem;
  font-weight: 600;
  line-height: 1.4;
}

.decision-card.rdap-registered {
  border-color: oklch(69% 0.19 25 / 0.50);
  background:
    linear-gradient(135deg, oklch(69% 0.19 25 / 0.24), transparent 58%),
    oklch(100% 0 0 / 0.07);
  box-shadow: inset 3px 0 0 var(--nh-rose);
}

.decision-card.dns-registered {
  border-color: oklch(82% 0.16 78 / 0.46);
  background:
    linear-gradient(135deg, oklch(82% 0.16 78 / 0.20), transparent 58%),
    oklch(100% 0 0 / 0.07);
  box-shadow: inset 3px 0 0 var(--nh-amber);
}

.decision-card.rdap-clear,
.decision-card.dns-available {
  border-color: oklch(82% 0.17 142 / 0.42);
  background:
    linear-gradient(135deg, oklch(82% 0.17 142 / 0.18), transparent 58%),
    oklch(100% 0 0 / 0.07);
  box-shadow: inset 3px 0 0 var(--nh-lime);
}

.decision-card.dns-only {
  border-color: oklch(100% 0 0 / 0.20);
  background:
    linear-gradient(135deg, oklch(100% 0 0 / 0.10), transparent 58%),
    oklch(100% 0 0 / 0.06);
  box-shadow: inset 3px 0 0 oklch(78% 0.03 245);
}

.decision-card.needs-review {
  border-color: oklch(82% 0.16 78 / 0.48);
  background:
    linear-gradient(135deg, oklch(82% 0.16 78 / 0.20), transparent 58%),
    oklch(100% 0 0 / 0.07);
  box-shadow: inset 3px 0 0 var(--nh-amber);
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 10px;
}

.metric-card {
  min-width: 0;
  padding: 9px;
  border: 1px solid oklch(100% 0 0 / 0.12);
  border-radius: var(--nh-radius);
  background: oklch(100% 0 0 / 0.07);
}

.metric-grid span,
.metric-card small,
.tooltip-section-title,
.tooltip-footer {
  display: block;
  color: oklch(82% 0.04 245 / 0.76);
  font-size: 0.72rem;
  font-weight: 600;
}

.metric-grid strong {
  display: block;
  margin-top: 2px;
  font-size: 0.82rem;
  overflow-wrap: anywhere;
}

.metric-card small {
  margin-top: 5px;
  color: oklch(96% 0.02 245);
  font-size: 0.68rem;
  text-transform: uppercase;
}

.metric-card.decisive {
  background:
    linear-gradient(135deg, oklch(100% 0 0 / 0.11), transparent 64%),
    oklch(100% 0 0 / 0.08);
}

.metric-card.decisive.rdap-registered {
  border-color: oklch(69% 0.19 25 / 0.58);
  box-shadow: inset 3px 0 0 var(--nh-rose);
}

.metric-card.decisive.dns-registered,
.metric-card.decisive.needs-review {
  border-color: oklch(82% 0.16 78 / 0.56);
  box-shadow: inset 3px 0 0 var(--nh-amber);
}

.metric-card.decisive.rdap-clear,
.metric-card.decisive.dns-available {
  border-color: oklch(82% 0.17 142 / 0.52);
  box-shadow: inset 3px 0 0 var(--nh-lime);
}

.metric-card.decisive.dns-only {
  border-color: oklch(100% 0 0 / 0.30);
  box-shadow: inset 3px 0 0 oklch(78% 0.03 245);
}

.reason-list {
  margin-top: 12px;
}

.tooltip-section-title {
  margin-bottom: 7px;
  text-transform: uppercase;
}

.reason-item {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr);
  gap: 8px;
  padding: 7px 0;
  border-top: 1px solid oklch(100% 0 0 / 0.08);
}

.reason-item.sub {
  padding-left: 12px;
}

.reason-dot {
  width: 7px;
  height: 7px;
  margin-top: 6px;
  border-radius: 50%;
  background: oklch(78% 0.03 245);
}

.reason-item.positive .reason-dot {
  background: var(--nh-lime);
}

.reason-item.negative .reason-dot {
  background: var(--nh-rose);
}

.reason-item p {
  margin: 0;
  color: oklch(94% 0.02 245);
  font-size: 0.76rem;
  line-height: 1.45;
}

.tooltip-footer {
  margin-top: 10px;
  padding-top: 9px;
  border-top: 1px solid oklch(100% 0 0 / 0.12);
}

.action-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 76px;
  padding: 0 12px;
  color: oklch(12% 0.04 260);
  background: linear-gradient(135deg, var(--nh-cyan), var(--nh-violet));
  text-decoration: none;
  box-shadow: 0 10px 24px oklch(72% 0.18 300 / 0.22);
}

.action-link:hover {
  filter: brightness(1.08) saturate(1.08);
}

.action-link.muted {
  color: var(--nh-muted);
  background: oklch(100% 0 0 / 0.08);
  box-shadow: none;
  border: 1px solid oklch(100% 0 0 / 0.14);
}

@keyframes pulse-once {
  0% { box-shadow: 0 0 0 0 oklch(83% 0.145 205 / 0.42), inset 0 1px 0 oklch(100% 0 0 / 0.18); }
  100% { box-shadow: 0 12px 36px oklch(5% 0.035 260 / 0.22), inset 0 1px 0 oklch(100% 0 0 / 0.18); }
}

.animate-pulse-once {
  animation: pulse-once 1.5s ease-in-out;
}

@media (max-width: 760px) {
  .result-row {
    grid-template-columns: 1fr;
    align-items: stretch;
  }

  .parking-badges,
  .result-actions {
    justify-content: flex-start;
  }

  .result-actions {
    flex-wrap: wrap;
  }

  .evidence-tooltip {
    left: 0;
    right: auto;
    transform-origin: top left;
  }
}
</style>
