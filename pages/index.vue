<template>
  <div class="scan-page">
    <section class="hero-band">
      <div class="hero-copy">
        <div class="hero-meta">
          <div class="brand-line">
            <span class="brand-mark"></span>
            NinjaHorder
          </div>
          <div
            class="hero-tagline term-help"
            tabindex="0"
            title="DNS checks query public resolver records. Fast and private, but not registrar-authoritative."
            aria-label="DNS checks query public resolver records. They are fast and private, but not registrar-authoritative."
            data-tip="DNS checks query public resolver records. Fast and private, but not registrar-authoritative."
          >
            DNS-only scouting
          </div>
        </div>
        <h1>Private domain radar</h1>
        <p>
          Fast browser-side DNS scouting with multi-resolver evidence and no registrar lookup by default.
        </p>
      </div>
      <div class="hero-console" aria-hidden="true">
        <div class="radar-scope">
          <span class="radar-ring ring-one"></span>
          <span class="radar-ring ring-two"></span>
          <span class="radar-ring ring-three"></span>
          <span class="radar-sweep"></span>
          <span class="radar-point point-one"></span>
          <span class="radar-point point-two"></span>
          <span class="radar-point point-three"></span>
        </div>
        <div class="hero-metrics">
          <div>
            <span>Resolvers</span>
            <strong>{{ activeProviders.length }}</strong>
          </div>
          <div>
            <span>Mode</span>
            <strong>Local</strong>
          </div>
          <div>
            <span>Lookup</span>
            <strong
              class="term-help"
              tabindex="0"
              title="Domain Name System evidence from public resolvers."
              aria-label="DNS is the domain name system. This app checks DNS evidence before any registry lookup."
              data-tip="Domain Name System evidence from public resolvers."
            >DNS</strong>
          </div>
        </div>
      </div>
    </section>

    <DomainForm :initialData="initialFormData" @submit="handleSubmit" />

    <div v-if="wasCancelled" class="notice-panel">
      Previous domain check was cancelled. Starting a new search will perform a fresh lookup.
    </div>

    <section v-if="isChecking" class="glass-panel scan-console">
      <div class="console-header">
        <div>
          <p class="console-label">Scan status</p>
          <h2>{{ getStageMessage(progress.stage) }}</h2>
        </div>
        <div class="domain-counter">
          {{ progress.domainsProcessed }} / {{ progress.totalDomains }}
        </div>
      </div>

      <div class="progress-track" aria-label="Domain check progress">
        <div class="progress-fill" :style="{ width: `${progress.percentage}%` }"></div>
      </div>

      <div class="console-grid">
        <div class="current-domain">
          <span>Target</span>
          <strong>{{ progress.currentDomain || 'Preparing resolver set' }}</strong>
          <small>{{ progress.detailedMessage || `${Math.round(progress.percentage)}% complete` }}</small>
        </div>

        <div class="provider-rail">
          <div
            v-for="provider in activeProviders"
            :key="provider.name"
            class="provider-pill"
            :class="providerStatusClass(provider)"
          >
            <span class="provider-dot"></span>
            {{ provider.name }}
          </div>
        </div>
      </div>

      <div v-if="progress.errors && progress.errors.length > 0" class="error-panel">
        <h3>Issues detected</h3>
        <ul>
          <li v-for="(error, index) in progress.errors" :key="index">
            {{ error }}
          </li>
        </ul>
      </div>

      <div v-if="isChecking && !(progress.stage === CheckStage.COMPLETE || progress.stage === CheckStage.CANCELLED || progress.stage === CheckStage.ERROR)" class="console-actions">
        <button
          @click="handleCancel"
          @keydown.enter="handleCancel"
          class="cancel-button"
          tabindex="0"
          aria-label="Cancel domain check"
        >
          Cancel Scan
        </button>
      </div>
    </section>

    <section v-if="hasResults" class="results-shell">
      <div class="results-header">
        <div>
          <p class="console-label">Evidence board</p>
          <h2>Results</h2>
        </div>
        <div class="result-count">{{ filteredResultsCount }} / {{ totalResults }} domains</div>
      </div>

      <div class="result-filters" aria-label="Filter results">
        <div class="filter-search">
          <label for="result-search">Find</label>
          <input
            id="result-search"
            v-model="resultSearch"
            type="search"
            class="glass-field"
            placeholder="domain or .tld"
          />
        </div>

        <div class="filter-set" aria-label="Status filter">
          <span class="filter-label">Status</span>
          <div class="filter-chips">
            <button
              v-for="option in statusFilterOptions"
              :key="option.value"
              type="button"
              class="filter-chip"
              :class="{ active: statusFilter === option.value }"
              :disabled="option.count === 0 && statusFilter !== option.value"
              @click="statusFilter = option.value"
            >
              <span>{{ option.label }}</span>
              <strong>{{ option.count }}</strong>
            </button>
          </div>
        </div>

        <div class="filter-set" aria-label="TLD group filter">
          <span class="filter-label">TLD</span>
          <div class="filter-chips">
            <button
              v-for="option in tldFilterOptions"
              :key="option.value"
              type="button"
              class="filter-chip"
              :class="{ active: tldFilter === option.value }"
              :disabled="option.count === 0 && tldFilter !== option.value"
              @click="tldFilter = option.value"
            >
              <span>{{ option.label }}</span>
              <strong>{{ option.count }}</strong>
            </button>
          </div>
        </div>

        <button
          v-if="filtersActive"
          type="button"
          class="clear-filters"
          @click="clearResultFilters"
        >
          Clear
        </button>
      </div>

      <div v-if="filteredResultsCount === 0" class="empty-results">
        <strong>No matches</strong>
        <span>Change the filters or clear them to show all domains.</span>
      </div>

      <div v-if="filteredGroups.available.length > 0" class="result-group">
        <h3>Likely Available — Verify <span>{{ filteredGroups.available.length }}</span></h3>
        <DomainResult v-for="result in filteredGroups.available" :key="result.domain" :result="result" />
      </div>
      <div v-if="filteredGroups.premium.length > 0" class="result-group">
        <h3>Premium Signals <span>{{ filteredGroups.premium.length }}</span></h3>
        <DomainResult v-for="result in filteredGroups.premium" :key="result.domain" :result="result" />
      </div>
      <div v-if="filteredGroups.notAvailable.length > 0" class="result-group">
        <h3>Registered <span>{{ filteredGroups.notAvailable.length }}</span></h3>
        <DomainResult v-for="result in filteredGroups.notAvailable" :key="result.domain" :result="result" />
      </div>
      <div v-if="filteredGroups.other.length > 0" class="result-group">
        <h3>Indeterminate / Error <span>{{ filteredGroups.other.length }}</span></h3>
        <DomainResult v-for="result in filteredGroups.other" :key="result.domain" :result="result" />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useDomainCheck, stageMessages, CheckStage, DomainAvailabilityStatus } from '~/composables/useDomainCheck'
import type { DomainResult } from '~/composables/domain'
import { ACTIVE_DOH_PROVIDER_KEYS, PROVIDERS } from '~/config/appConfig'
import { popularTLDs, countryTLDs, customTLDs } from '~/utils/tlds'

const { checkDomains, groupedResults, progress, isChecking, cancelCheck } = useDomainCheck()
const results = groupedResults
const wasCancelled = ref(false)
type StatusFilter = 'all' | 'needs_review' | DomainAvailabilityStatus.AVAILABLE | DomainAvailabilityStatus.REGISTERED | DomainAvailabilityStatus.PREMIUM
type TldFilter = 'all' | 'popular' | 'country' | 'modern'

const resultSearch = ref('')
const statusFilter = ref<StatusFilter>('all')
const tldFilter = ref<TldFilter>('all')
const popularTldSet = new Set(popularTLDs)
const countryTldSet = new Set(countryTLDs)
const customTldSet = new Set(customTLDs)
const knownTlds = Array.from(new Set([...popularTLDs, ...countryTLDs, ...customTLDs]))
  .sort((a, b) => b.length - a.length)

watch(() => progress.value.stage, (newStage) => {
  if (newStage === CheckStage.CANCELLED) {
    wasCancelled.value = true
  }
})

watch(() => isChecking.value, (newValue) => {
  if (newValue === true) {
    wasCancelled.value = false
  }
})

const getStageMessage = (stage: CheckStage): string => {
  if (!stage || !(stage in stageMessages)) {
    return 'Processing...'
  }
  return stageMessages[stage as keyof typeof stageMessages] || 'Processing...'
}

const initialFormData = ref({
  domain: '',
  popularTLDs: true,
  countryTLDs: false,
  customTLDs: false,
  verifyWithRdap: false,
})

const allResults = computed<DomainResult[]>(() => [
  ...results.value.available,
  ...results.value.premium,
  ...results.value.notAvailable,
  ...results.value.other,
])

const totalResults = computed(() => allResults.value.length)

const hasResults = computed(() => totalResults.value > 0)

const getDomainTld = (domain: string): string => {
  const normalized = domain.toLowerCase()
  const knownMatch = knownTlds.find(tld => normalized.endsWith(tld))

  if (knownMatch) return knownMatch

  const [, ...parts] = normalized.split('.')
  return parts.length > 0 ? `.${parts.join('.')}` : ''
}

const getTldGroup = (domain: string): Exclude<TldFilter, 'all'> | 'unknown' => {
  const tld = getDomainTld(domain)

  if (popularTldSet.has(tld)) return 'popular'
  if (countryTldSet.has(tld)) return 'country'
  if (customTldSet.has(tld)) return 'modern'
  return 'unknown'
}

const matchesStatusFilter = (result: DomainResult, filter: StatusFilter) => {
  if (filter === 'all') return true
  if (filter === 'needs_review') {
    return result.status === DomainAvailabilityStatus.INDETERMINATE ||
      result.status === DomainAvailabilityStatus.ERROR
  }

  return result.status === filter
}

const matchesTldFilter = (result: DomainResult, filter: TldFilter) => {
  if (filter === 'all') return true
  return getTldGroup(result.domain) === filter
}

const filteredResults = computed(() => {
  const query = resultSearch.value.trim().toLowerCase()

  return allResults.value.filter(result => {
    const matchesSearch = !query ||
      result.domain.toLowerCase().includes(query) ||
      getDomainTld(result.domain).includes(query.startsWith('.') ? query : `.${query}`)

    return matchesSearch &&
      matchesStatusFilter(result, statusFilter.value) &&
      matchesTldFilter(result, tldFilter.value)
  })
})

const filteredResultsCount = computed(() => filteredResults.value.length)

const filteredGroups = computed(() => ({
  available: filteredResults.value.filter(result => result.status === DomainAvailabilityStatus.AVAILABLE),
  premium: filteredResults.value.filter(result => result.status === DomainAvailabilityStatus.PREMIUM),
  notAvailable: filteredResults.value.filter(result => result.status === DomainAvailabilityStatus.REGISTERED),
  other: filteredResults.value.filter(result =>
    result.status === DomainAvailabilityStatus.INDETERMINATE ||
    result.status === DomainAvailabilityStatus.ERROR
  ),
}))

const countStatus = (filter: StatusFilter) =>
  allResults.value.filter(result => matchesStatusFilter(result, filter)).length

const countTldGroup = (filter: TldFilter) =>
  allResults.value.filter(result => matchesTldFilter(result, filter)).length

const statusFilterOptions = computed<Array<{ value: StatusFilter, label: string, count: number }>>(() => [
  { value: 'all', label: 'All', count: totalResults.value },
  { value: DomainAvailabilityStatus.AVAILABLE, label: 'Likely', count: countStatus(DomainAvailabilityStatus.AVAILABLE) },
  { value: DomainAvailabilityStatus.PREMIUM, label: 'Premium', count: countStatus(DomainAvailabilityStatus.PREMIUM) },
  { value: DomainAvailabilityStatus.REGISTERED, label: 'Registered', count: countStatus(DomainAvailabilityStatus.REGISTERED) },
  { value: 'needs_review', label: 'Review', count: countStatus('needs_review') },
])

const tldFilterOptions = computed<Array<{ value: TldFilter, label: string, count: number }>>(() => [
  { value: 'all', label: 'All', count: totalResults.value },
  { value: 'popular', label: 'Popular', count: countTldGroup('popular') },
  { value: 'country', label: 'Country', count: countTldGroup('country') },
  { value: 'modern', label: 'Modern', count: countTldGroup('modern') },
])

const filtersActive = computed(() =>
  resultSearch.value.trim().length > 0 ||
  statusFilter.value !== 'all' ||
  tldFilter.value !== 'all'
)

const clearResultFilters = () => {
  resultSearch.value = ''
  statusFilter.value = 'all'
  tldFilter.value = 'all'
}

const activeProviders = computed(() => {
  if (progress.value.providers && progress.value.providers.length > 0) {
    return progress.value.providers.map((providerStatus: { url: string, name?: string, active: boolean }) => ({
      name: providerStatus.name || providerStatus.url,
      baseUrl: providerStatus.url,
      status: providerStatus.active ? 'active' : 'failed'
    }))
  }

  return ACTIVE_DOH_PROVIDER_KEYS.map(key => PROVIDERS[key]).map(provider => ({
    name: provider.name,
    baseUrl: provider.baseUrl,
    status: isChecking.value ? 'active' : 'inactive'
  }))
})

const providerStatusClass = (provider: { status: string }) => {
  switch (provider.status) {
    case 'active':
      return 'is-active'
    case 'failed':
      return 'is-failed'
    default:
      return 'is-idle'
  }
}

const handleSubmit = async (data: { domain: string, tlds: string[], verifyWithRdap: boolean }) => {
  await checkDomains(data.domain, data.tlds, { verifyWithRdap: data.verifyWithRdap })
}

const handleCancel = () => {
  cancelCheck()
}
</script>

<style scoped>
.scan-page {
  width: min(100% - 32px, 1040px);
  margin: 0 auto;
  padding: 40px 0 56px;
}

.hero-band {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(260px, 0.42fr);
  gap: 20px;
  align-items: center;
  margin-bottom: 20px;
  padding: 18px 20px;
  overflow: hidden;
  border: 1px solid oklch(100% 0 0 / 0.12);
  border-radius: calc(var(--nh-radius) + 2px);
  background:
    linear-gradient(135deg, oklch(9% 0.045 255 / 0.66), oklch(22% 0.075 270 / 0.34)),
    linear-gradient(90deg, oklch(83% 0.145 205 / 0.10), transparent 55%);
  box-shadow: inset 0 1px 0 oklch(100% 0 0 / 0.12);
}

.hero-band::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    repeating-linear-gradient(115deg, transparent 0 22px, oklch(100% 0 0 / 0.05) 23px 24px),
    linear-gradient(90deg, oklch(83% 0.145 205 / 0.09), transparent 42%, oklch(82% 0.16 78 / 0.06));
  opacity: 0.5;
}

.hero-copy,
.hero-console {
  position: relative;
  z-index: 1;
}

.hero-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-bottom: 18px;
}

.brand-line {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  color: var(--nh-cyan);
  font-size: 0.82rem;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0;
}

.brand-mark {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--nh-lime);
  box-shadow: 0 0 18px var(--nh-lime);
}

.hero-tagline {
  display: inline-flex;
  width: fit-content;
  padding: 5px 9px;
  border: 1px solid oklch(82% 0.16 78 / 0.34);
  border-radius: 999px;
  color: oklch(91% 0.11 78);
  background: oklch(82% 0.16 78 / 0.10);
  font-size: 0.72rem;
  font-weight: 900;
  text-transform: uppercase;
}

.hero-copy h1 {
  margin: 0;
  max-width: 680px;
  color: var(--nh-text);
  font-size: clamp(2.35rem, 5.7vw, 4.35rem);
  line-height: 0.96;
  letter-spacing: 0;
}

.hero-copy p {
  max-width: 620px;
  margin: 14px 0 0;
  color: var(--nh-muted);
  font-size: clamp(0.98rem, 2vw, 1.08rem);
  line-height: 1.55;
}

.hero-console {
  display: grid;
  grid-template-columns: minmax(154px, 1fr) 120px;
  gap: 12px;
  align-items: stretch;
  min-height: 170px;
}

.radar-scope,
.hero-metrics {
  border: 1px solid oklch(100% 0 0 / 0.18);
  border-radius: var(--nh-radius);
  background: oklch(6% 0.035 255 / 0.34);
  box-shadow: inset 0 1px 0 oklch(100% 0 0 / 0.13);
}

.radar-scope {
  position: relative;
  min-height: 170px;
  overflow: hidden;
  background:
    linear-gradient(90deg, oklch(83% 0.145 205 / 0.10) 1px, transparent 1px),
    linear-gradient(oklch(83% 0.145 205 / 0.08) 1px, transparent 1px),
    oklch(6% 0.035 255 / 0.34);
  background-size: 32px 32px;
}

.radar-ring {
  position: absolute;
  left: 50%;
  top: 50%;
  border: 1px solid oklch(83% 0.145 205 / 0.24);
  border-radius: 50%;
  transform: translate(-50%, -50%);
}

.ring-one { width: 68px; height: 68px; }
.ring-two { width: 116px; height: 116px; }
.ring-three { width: 166px; height: 166px; }

.radar-sweep {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 84px;
  height: 2px;
  background: linear-gradient(90deg, var(--nh-cyan), transparent);
  box-shadow: 0 0 18px oklch(83% 0.145 205 / 0.44);
  transform-origin: left center;
  animation: radar-scan 3.6s linear infinite;
}

.radar-point {
  position: absolute;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--nh-lime);
  box-shadow: 0 0 18px var(--nh-lime);
}

.point-one { left: 66%; top: 28%; }
.point-two { left: 34%; top: 61%; background: var(--nh-amber); box-shadow: 0 0 18px var(--nh-amber); }
.point-three { left: 59%; top: 72%; background: var(--nh-cyan); box-shadow: 0 0 18px var(--nh-cyan); }

.hero-metrics {
  display: grid;
  gap: 8px;
  padding: 10px;
}

.hero-metrics div {
  display: grid;
  align-content: center;
  gap: 3px;
  min-height: 44px;
  padding: 8px;
  border: 1px solid oklch(100% 0 0 / 0.12);
  border-radius: var(--nh-radius);
  background: oklch(100% 0 0 / 0.07);
}

.hero-metrics span {
  color: oklch(82% 0.04 245 / 0.78);
  font-size: 0.68rem;
  font-weight: 900;
  text-transform: uppercase;
}

.hero-metrics strong {
  color: var(--nh-text);
  font-size: 1.2rem;
  line-height: 1;
}

.hero-metrics div:nth-child(2) strong {
  color: oklch(91% 0.11 78);
}

.hero-metrics div:nth-child(3) strong {
  color: oklch(90% 0.12 142);
}

.term-help {
  position: relative;
  z-index: 5;
  cursor: help;
}

.term-help::after {
  content: attr(data-tip);
  position: absolute;
  left: 0;
  bottom: calc(100% + 9px);
  z-index: 50;
  width: min(260px, calc(100vw - 32px));
  padding: 8px 9px;
  border: 1px solid oklch(100% 0 0 / 0.18);
  border-radius: var(--nh-radius);
  color: var(--nh-text);
  background: oklch(11% 0.04 255 / 0.96);
  box-shadow: 0 16px 36px oklch(4% 0.035 260 / 0.42);
  font-size: 0.72rem;
  font-weight: 800;
  line-height: 1.35;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translateY(3px);
  transition: opacity 150ms ease, transform 150ms ease, visibility 150ms ease;
  text-transform: none;
}

.term-help:hover::after,
.term-help:focus::after,
.term-help:focus-visible::after {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
}

.notice-panel {
  margin-top: 14px;
  padding: 12px 14px;
  border: 1px solid oklch(82% 0.16 78 / 0.38);
  border-radius: var(--nh-radius);
  color: oklch(90% 0.10 78);
  background: oklch(82% 0.16 78 / 0.10);
  font-weight: 700;
  backdrop-filter: blur(14px);
}

.scan-console {
  margin-top: 18px;
  padding: 16px;
}

.console-header,
.results-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: start;
}

.console-label {
  margin: 0 0 4px;
  color: var(--nh-cyan);
  font-size: 0.72rem;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0;
}

.console-header h2,
.results-header h2 {
  margin: 0;
  color: var(--nh-text);
  font-size: 1.12rem;
  line-height: 1.2;
}

.domain-counter,
.result-count {
  flex: 0 0 auto;
  padding: 7px 10px;
  border: 1px solid oklch(100% 0 0 / 0.18);
  border-radius: 999px;
  color: var(--nh-text);
  background: oklch(100% 0 0 / 0.08);
  font-size: 0.82rem;
  font-weight: 900;
}

.progress-track {
  position: relative;
  height: 9px;
  margin-top: 14px;
  overflow: hidden;
  border: 1px solid oklch(100% 0 0 / 0.13);
  border-radius: 999px;
  background: oklch(7% 0.035 260 / 0.46);
}

.progress-fill {
  height: 100%;
  border-radius: inherit;
  background:
    linear-gradient(90deg, var(--nh-cyan), var(--nh-violet), var(--nh-lime));
  box-shadow: 0 0 18px oklch(83% 0.145 205 / 0.42);
  transition: width 260ms ease;
}

.console-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(220px, 0.7fr);
  gap: 12px;
  margin-top: 14px;
}

.current-domain,
.provider-rail {
  min-width: 0;
  border: 1px solid oklch(100% 0 0 / 0.14);
  border-radius: var(--nh-radius);
  background: oklch(100% 0 0 / 0.07);
  box-shadow: inset 0 1px 0 oklch(100% 0 0 / 0.14);
}

.current-domain {
  display: grid;
  gap: 3px;
  padding: 12px;
}

.current-domain span,
.current-domain small {
  color: oklch(82% 0.04 245 / 0.78);
  font-size: 0.78rem;
  font-weight: 800;
}

.current-domain strong {
  color: var(--nh-text);
  font-size: 1rem;
  overflow-wrap: anywhere;
}

.provider-rail {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-content: center;
  padding: 10px;
}

.provider-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 30px;
  padding: 6px 9px;
  border-radius: 999px;
  border: 1px solid oklch(100% 0 0 / 0.14);
  color: var(--nh-muted);
  background: oklch(100% 0 0 / 0.07);
  font-size: 0.78rem;
  font-weight: 900;
}

.provider-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: oklch(70% 0.02 245);
}

.provider-pill.is-active {
  color: oklch(93% 0.09 205);
  border-color: oklch(83% 0.145 205 / 0.42);
}

.provider-pill.is-active .provider-dot {
  background: var(--nh-cyan);
  box-shadow: 0 0 14px var(--nh-cyan);
  animation: dot-pulse 900ms ease-in-out infinite alternate;
}

.provider-pill.is-failed {
  color: oklch(88% 0.10 25);
  border-color: oklch(69% 0.19 25 / 0.40);
}

.provider-pill.is-failed .provider-dot {
  background: var(--nh-rose);
}

.error-panel {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid oklch(69% 0.19 25 / 0.36);
  border-radius: var(--nh-radius);
  color: oklch(90% 0.10 25);
  background: oklch(69% 0.19 25 / 0.10);
}

.error-panel h3 {
  margin: 0 0 6px;
  font-size: 0.88rem;
}

.error-panel ul {
  margin: 0;
  padding-left: 18px;
  font-size: 0.84rem;
}

.console-actions {
  display: flex;
  justify-content: center;
  margin-top: 14px;
}

.cancel-button {
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid oklch(100% 0 0 / 0.20);
  border-radius: var(--nh-radius);
  color: var(--nh-text);
  background: oklch(100% 0 0 / 0.08);
  font-weight: 900;
}

.cancel-button:hover {
  background: oklch(100% 0 0 / 0.14);
}

.results-shell {
  margin-top: 24px;
}

.result-filters {
  display: grid;
  grid-template-columns: minmax(210px, 0.7fr) minmax(0, 1fr) minmax(0, 0.9fr) auto;
  gap: 12px;
  align-items: end;
  margin-top: 14px;
  padding: 12px;
  border: 1px solid oklch(100% 0 0 / 0.16);
  border-radius: var(--nh-radius);
  background:
    linear-gradient(145deg, oklch(100% 0 0 / 0.10), oklch(100% 0 0 / 0.05)),
    oklch(8% 0.035 260 / 0.24);
  box-shadow: inset 0 1px 0 oklch(100% 0 0 / 0.14);
  backdrop-filter: blur(18px) saturate(1.2);
  -webkit-backdrop-filter: blur(18px) saturate(1.2);
}

.filter-search {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.filter-search label,
.filter-label {
  color: oklch(82% 0.04 245 / 0.84);
  font-size: 0.72rem;
  font-weight: 900;
  text-transform: uppercase;
}

.filter-search input {
  width: 100%;
  height: 38px;
  padding: 0 11px;
  font-size: 0.9rem;
  font-weight: 800;
}

.filter-set {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.filter-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.filter-chip,
.clear-filters {
  min-height: 38px;
  border: 1px solid oklch(100% 0 0 / 0.15);
  border-radius: var(--nh-radius);
  color: var(--nh-muted);
  background: oklch(100% 0 0 / 0.07);
  font-weight: 900;
  cursor: pointer;
  transition: border-color 160ms ease, background 160ms ease, color 160ms ease, opacity 160ms ease;
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 0 9px;
  font-size: 0.78rem;
}

.filter-chip strong {
  min-width: 22px;
  padding: 2px 6px;
  border-radius: 999px;
  color: var(--nh-text);
  background: oklch(100% 0 0 / 0.10);
  font-size: 0.72rem;
  text-align: center;
}

.filter-chip.active {
  color: oklch(94% 0.08 205);
  border-color: oklch(83% 0.145 205 / 0.68);
  background:
    linear-gradient(135deg, oklch(83% 0.145 205 / 0.18), oklch(72% 0.18 300 / 0.11)),
    oklch(100% 0 0 / 0.08);
  box-shadow: inset 0 -2px 0 var(--nh-cyan);
}

.filter-chip:hover:not(:disabled),
.clear-filters:hover {
  color: var(--nh-text);
  border-color: oklch(100% 0 0 / 0.28);
  background: oklch(100% 0 0 / 0.11);
}

.filter-chip:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.clear-filters {
  align-self: end;
  padding: 0 12px;
  color: oklch(91% 0.10 78);
  border-color: oklch(82% 0.16 78 / 0.34);
  background: oklch(82% 0.16 78 / 0.09);
  font-size: 0.78rem;
}

.empty-results {
  display: grid;
  gap: 3px;
  margin-top: 16px;
  padding: 18px;
  border: 1px solid oklch(100% 0 0 / 0.15);
  border-radius: var(--nh-radius);
  color: var(--nh-muted);
  background: oklch(100% 0 0 / 0.06);
}

.empty-results strong {
  color: var(--nh-text);
}

.result-group {
  margin-top: 16px;
}

.result-group h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 10px;
  color: var(--nh-muted);
  font-size: 0.86rem;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0;
}

.result-group h3 span {
  min-width: 24px;
  padding: 2px 7px;
  border: 1px solid oklch(100% 0 0 / 0.14);
  border-radius: 999px;
  color: var(--nh-text);
  background: oklch(100% 0 0 / 0.08);
  font-size: 0.72rem;
  text-align: center;
}

@keyframes meter-pulse {
  0% { opacity: 0.55; transform: translateY(2px); }
  100% { opacity: 1; transform: translateY(-2px); }
}

@keyframes radar-scan {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

@keyframes dot-pulse {
  0% { opacity: 0.55; transform: scale(0.86); }
  100% { opacity: 1; transform: scale(1.12); }
}

@media (max-width: 760px) {
  .scan-page {
    width: min(100% - 24px, 1040px);
    padding-top: 24px;
  }

  .hero-band,
  .console-grid {
    grid-template-columns: 1fr;
  }

  .hero-band {
    padding: 16px;
  }

  .hero-console {
    grid-template-columns: 1fr;
    min-height: 0;
  }

  .radar-scope {
    min-height: 164px;
  }

  .hero-meta {
    margin-bottom: 14px;
  }

  .console-header,
  .results-header {
    align-items: stretch;
    flex-direction: column;
  }

  .result-filters {
    grid-template-columns: 1fr;
  }

  .domain-counter,
  .result-count {
    width: fit-content;
  }
}
</style>
