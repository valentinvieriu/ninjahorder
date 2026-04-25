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
        </div>
      </div>
    </div>

    <div v-if="isParkedDomain" class="parking-badges">
      <span v-if="result.isParkedByNs">NS Parked</span>
      <span v-if="result.isParkedByTxt">TXT Parked</span>
    </div>

    <div class="result-actions">
      <span class="status-badge" :class="statusBadgeClass">{{ statusText }}</span>

      <div class="info-wrap">
        <button type="button" class="info-button" aria-label="Show DNS evidence">
          i
        </button>

        <div class="evidence-tooltip">
          <div class="tooltip-header">
            <strong>{{ result.domain }}</strong>
            <span class="status-badge compact" :class="statusBadgeClass">{{ statusText }}</span>
          </div>

          <div class="metric-grid">
            <div>
              <span>Status</span>
              <strong>{{ statusText }}</strong>
            </div>
            <div>
              <span>DNSSEC</span>
              <strong>{{ result.dnssecValidated ? 'Validated' : 'Not validated' }}</strong>
            </div>
            <div>
              <span>Wildcard</span>
              <strong>{{ result.wildcardDetected ? 'Detected' : 'Not detected' }}</strong>
            </div>
            <div>
              <span>Parking</span>
              <strong>{{ isParkedDomain ? parkingType : 'Not detected' }}</strong>
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

const props = defineProps<{
  result: {
    domain: string
    status: DomainAvailabilityStatus
    error: boolean
    link: string
    confidenceReasons: string[]
    confidenceScore?: number
    dnssecValidated?: boolean
    wildcardDetected?: boolean
    isParkedByNs: boolean
    isParkedByTxt: boolean
  }
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
  if (props.result.status === DomainAvailabilityStatus.REGISTERED && isParkedDomain.value) {
    return 'Registered Parked'
  }

  switch (props.result.status) {
    case DomainAvailabilityStatus.AVAILABLE:
      return 'Likely Available — Verify'
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
  font-weight: 900;
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
  font-weight: 800;
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
.info-button {
  min-height: 32px;
  border-radius: var(--nh-radius);
  font-size: 0.76rem;
  font-weight: 900;
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

.evidence-tooltip {
  position: absolute;
  right: 0;
  top: -10px;
  z-index: 40;
  width: min(440px, calc(100vw - 32px));
  max-height: min(520px, 75vh);
  padding: 13px;
  overflow-y: auto;
  transform: translateY(-100%) scale(0.98);
  transform-origin: bottom right;
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
  transform: translateY(-100%) scale(1);
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

.metric-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 10px;
}

.metric-grid div {
  min-width: 0;
  padding: 9px;
  border: 1px solid oklch(100% 0 0 / 0.12);
  border-radius: var(--nh-radius);
  background: oklch(100% 0 0 / 0.07);
}

.metric-grid span,
.tooltip-section-title,
.tooltip-footer {
  display: block;
  color: oklch(82% 0.04 245 / 0.76);
  font-size: 0.72rem;
  font-weight: 800;
}

.metric-grid strong {
  display: block;
  margin-top: 2px;
  font-size: 0.82rem;
  overflow-wrap: anywhere;
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
    transform-origin: bottom left;
  }
}
</style>
