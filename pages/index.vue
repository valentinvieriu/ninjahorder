<template>
  <div class="scan-page">
    <section class="hero-band">
      <div class="hero-copy">
        <div class="brand-line">
          <span class="brand-mark"></span>
          NinjaHorder
        </div>
        <h1>Private domain radar</h1>
        <p>
          Fast browser-side DNS scouting with multi-resolver evidence and no registrar lookup by default.
        </p>
      </div>
      <div class="signal-strip" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
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
        <div class="result-count">{{ totalResults }} domains</div>
      </div>

      <div v-if="results.available.length > 0" class="result-group">
        <h3>Likely Available</h3>
        <DomainResult v-for="result in results.available" :key="result.domain" :result="result" />
      </div>
      <div v-if="results.premium.length > 0" class="result-group">
        <h3>Premium Signals</h3>
        <DomainResult v-for="result in results.premium" :key="result.domain" :result="result" />
      </div>
      <div v-if="results.notAvailable.length > 0" class="result-group">
        <h3>Registered</h3>
        <DomainResult v-for="result in results.notAvailable" :key="result.domain" :result="result" />
      </div>
      <div v-if="results.other?.length > 0" class="result-group">
        <h3>Indeterminate / Error</h3>
        <DomainResult v-for="result in results.other" :key="result.domain" :result="result" />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useDomainCheck, stageMessages, CheckStage } from '~/composables/useDomainCheck'
import { ACTIVE_DOH_PROVIDER_KEYS, PROVIDERS } from '~/config/appConfig'

const { checkDomains, groupedResults, progress, isChecking, cancelCheck } = useDomainCheck()
const results = groupedResults
const wasCancelled = ref(false)

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
})

const hasResults = computed(() =>
  results.value.available.length > 0 ||
  results.value.premium.length > 0 ||
  results.value.notAvailable.length > 0 ||
  results.value.other.length > 0
)

const totalResults = computed(() =>
  results.value.available.length +
  results.value.premium.length +
  results.value.notAvailable.length +
  results.value.other.length
)

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

const handleSubmit = async (data: { domain: string, tlds: string[] }) => {
  await checkDomains(data.domain, data.tlds)
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
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 24px;
  align-items: end;
  margin-bottom: 18px;
}

.brand-line {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 10px;
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

.hero-copy h1 {
  margin: 0;
  max-width: 680px;
  color: var(--nh-text);
  font-size: clamp(2.25rem, 7vw, 5rem);
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

.signal-strip {
  display: grid;
  grid-template-columns: repeat(3, 42px);
  gap: 8px;
  padding-bottom: 10px;
}

.signal-strip span {
  height: 78px;
  border: 1px solid oklch(100% 0 0 / 0.18);
  border-radius: var(--nh-radius);
  background:
    linear-gradient(to top, oklch(83% 0.145 205 / 0.32), transparent),
    oklch(100% 0 0 / 0.06);
  box-shadow: inset 0 1px 0 oklch(100% 0 0 / 0.18);
  animation: meter-pulse 1.8s ease-in-out infinite alternate;
}

.signal-strip span:nth-child(2) {
  height: 108px;
  animation-delay: 240ms;
}

.signal-strip span:nth-child(3) {
  height: 62px;
  animation-delay: 520ms;
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

.result-group {
  margin-top: 16px;
}

.result-group h3 {
  margin: 0 0 10px;
  color: var(--nh-muted);
  font-size: 0.86rem;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0;
}

@keyframes meter-pulse {
  0% { opacity: 0.55; transform: translateY(2px); }
  100% { opacity: 1; transform: translateY(-2px); }
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

  .signal-strip {
    display: none;
  }

  .console-header,
  .results-header {
    align-items: stretch;
    flex-direction: column;
  }

  .domain-counter,
  .result-count {
    width: fit-content;
  }
}
</style>
