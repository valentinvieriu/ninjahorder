<template>
  <form @submit.prevent="handleSubmit" class="glass-panel command-panel">
    <div class="panel-header">
      <div>
        <p class="eyebrow">Private DNS Scout</p>
        <h2>Scan a domain stem</h2>
      </div>
      <div class="privacy-chip">
        Browser only
      </div>
    </div>

    <div class="search-row">
      <div class="relative flex-1">
        <input
          v-model="domain"
          type="text"
          id="domain"
          name="domain"
          required
          placeholder="example"
          class="glass-field domain-input"
          :class="{ 'field-error': domainError }"
          aria-label="Domain name"
          @input="validateDomain"
        />
        <button
          v-if="domain"
          type="button"
          @click="handleReset"
          title="Clear"
          class="clear-button"
          aria-label="Clear domain name"
        >
          x
        </button>
      </div>
      <button
        type="submit"
        class="neon-button scan-button"
        :disabled="!isFormValid"
        aria-label="Check domain availability"
      >
        Scan
      </button>
    </div>

    <div v-if="domainError" class="error-line">
      {{ domainError }}
    </div>

    <div class="tld-panel" aria-label="TLD groups">
      <label class="tld-toggle" :class="{ selected: popularTLDsChecked }">
        <input
          type="checkbox"
          v-model="popularTLDsChecked"
          aria-label="Include popular TLDs"
        />
        <span class="toggle-copy">
          <span class="toggle-title">Popular</span>
          <small>{{ popularTLDs.length }} zones</small>
        </span>
        <span class="toggle-indicator" aria-hidden="true"></span>
      </label>

      <label class="tld-toggle" :class="{ selected: countryTLDsChecked }">
        <input
          type="checkbox"
          v-model="countryTLDsChecked"
          aria-label="Include country TLDs"
        />
        <span class="toggle-copy">
          <span class="toggle-title">Country</span>
          <small>{{ countryTLDs.length }} zones</small>
        </span>
        <span class="toggle-indicator" aria-hidden="true"></span>
      </label>

      <label class="tld-toggle" :class="{ selected: customTLDsChecked }">
        <input
          type="checkbox"
          v-model="customTLDsChecked"
          aria-label="Include custom modern TLDs"
        />
        <span class="toggle-copy">
          <span class="toggle-title">Modern</span>
          <small>{{ customTLDs.length }} zones</small>
        </span>
        <span class="toggle-indicator" aria-hidden="true"></span>
      </label>
    </div>

    <div v-if="!isTldSelected" class="error-line">
      Select at least one TLD group.
    </div>

    <label class="rdap-toggle" :class="{ selected: verifyWithRdap }">
      <input
        type="checkbox"
        v-model="verifyWithRdap"
        aria-label="Verify likely available domains with RDAP"
      />
      <span class="toggle-copy">
        <span class="toggle-title">RDAP verify</span>
        <small>Registry data</small>
      </span>
      <span class="toggle-indicator" aria-hidden="true"></span>
    </label>
  </form>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { popularTLDs, countryTLDs, customTLDs } from '~/utils/tlds'

const props = defineProps<{
  initialData: {
    domain: string
    popularTLDs: boolean
    countryTLDs: boolean
    customTLDs: boolean
    verifyWithRdap: boolean
  }
}>()

const emit = defineEmits(['submit'])

const domain = ref(props.initialData.domain)
const popularTLDsChecked = ref(props.initialData.popularTLDs)
const countryTLDsChecked = ref(props.initialData.countryTLDs)
const customTLDsChecked = ref(props.initialData.customTLDs)
const verifyWithRdap = ref(props.initialData.verifyWithRdap)
const domainError = ref('')

watch(() => props.initialData, (newValue) => {
  domain.value = newValue.domain
  popularTLDsChecked.value = newValue.popularTLDs
  countryTLDsChecked.value = newValue.countryTLDs
  customTLDsChecked.value = newValue.customTLDs
  verifyWithRdap.value = newValue.verifyWithRdap
  validateDomain()
}, { deep: true })

const isTldSelected = computed(() => {
  return popularTLDsChecked.value || countryTLDsChecked.value || customTLDsChecked.value
})

const isFormValid = computed(() => {
  return domain.value.trim().length > 0 &&
         !domainError.value &&
         isTldSelected.value
})

const validateDomain = () => {
  domainError.value = ''

  if (!domain.value.trim()) return

  if (domain.value.length < 2) {
    domainError.value = 'Domain name must be at least 2 characters'
    return
  }

  if (domain.value.length > 63) {
    domainError.value = 'Domain name must be 63 characters or less'
    return
  }

  const validDomainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/
  if (!validDomainRegex.test(domain.value)) {
    domainError.value = 'Use letters, numbers, and hyphens only. No leading or trailing hyphen.'
    return
  }

  if (domain.value.includes('.')) {
    domainError.value = 'Enter only the domain name without a TLD.'
    return
  }
}

const handleSubmit = () => {
  validateDomain()

  if (!isFormValid.value) return

  const selectedTLDs: string[] = []
  if (popularTLDsChecked.value) selectedTLDs.push(...popularTLDs)
  if (countryTLDsChecked.value) selectedTLDs.push(...countryTLDs)
  if (customTLDsChecked.value) selectedTLDs.push(...customTLDs)

  // De-dupe in case a TLD appears in more than one selected group.
  const uniqueTLDs = Array.from(new Set(selectedTLDs))

  emit('submit', {
    domain: domain.value.trim(),
    tlds: uniqueTLDs,
    verifyWithRdap: verifyWithRdap.value
  })
}

const handleReset = () => {
  domain.value = ''
  domainError.value = ''
}
</script>

<style scoped>
.command-panel {
  position: relative;
  padding: 18px;
  overflow: hidden;
}

.command-panel::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(115deg, oklch(100% 0 0 / 0.22), transparent 24%),
    radial-gradient(circle at 86% 10%, oklch(83% 0.145 205 / 0.20), transparent 13rem);
}

.panel-header,
.search-row,
.tld-panel,
.rdap-toggle,
.error-line {
  position: relative;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: start;
  margin-bottom: 16px;
}

.eyebrow {
  margin: 0 0 3px;
  color: var(--nh-cyan);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: uppercase;
}

h2 {
  margin: 0;
  color: var(--nh-text);
  font-size: clamp(1.12rem, 2vw, 1.45rem);
  line-height: 1.15;
}

.privacy-chip {
  flex: 0 0 auto;
  border: 1px solid oklch(83% 0.145 205 / 0.36);
  border-radius: 999px;
  padding: 6px 10px;
  color: oklch(91% 0.065 205);
  background: oklch(83% 0.145 205 / 0.10);
  font-size: 0.76rem;
  font-weight: 800;
  white-space: nowrap;
}

.search-row {
  display: flex;
  gap: 10px;
}

.domain-input {
  width: 100%;
  height: 48px;
  padding: 0 42px 0 14px;
  font-size: 1.04rem;
  font-weight: 700;
}

.field-error {
  border-color: oklch(69% 0.19 25 / 0.85);
  box-shadow: 0 0 0 3px oklch(69% 0.19 25 / 0.16);
}

.clear-button {
  position: absolute;
  right: 10px;
  top: 50%;
  width: 28px;
  height: 28px;
  transform: translateY(-50%);
  border: 1px solid oklch(100% 0 0 / 0.14);
  border-radius: 999px;
  color: var(--nh-muted);
  background: oklch(100% 0 0 / 0.08);
  font-weight: 800;
  line-height: 1;
}

.clear-button:hover {
  color: var(--nh-text);
  background: oklch(100% 0 0 / 0.16);
}

.scan-button {
  min-width: 104px;
  height: 48px;
  padding: 0 18px;
  font-weight: 900;
  transition: transform 180ms ease, filter 180ms ease, opacity 180ms ease;
}

.tld-panel {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 12px;
}

.tld-toggle,
.rdap-toggle {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 26px;
  gap: 10px;
  align-items: center;
  min-height: 58px;
  padding: 10px 12px;
  border: 1px solid oklch(100% 0 0 / 0.14);
  border-radius: var(--nh-radius);
  color: var(--nh-muted);
  background: oklch(8% 0.035 260 / 0.34);
  cursor: pointer;
  opacity: 0.72;
  transition: transform 180ms ease, border-color 180ms ease, background 180ms ease, color 180ms ease, opacity 180ms ease, box-shadow 180ms ease;
}

.tld-toggle input,
.rdap-toggle input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.toggle-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.toggle-title {
  color: var(--nh-text);
  font-size: 0.92rem;
  font-weight: 900;
}

.tld-toggle small,
.rdap-toggle small {
  color: oklch(82% 0.04 245 / 0.78);
  font-size: 0.74rem;
  font-weight: 700;
}

.toggle-indicator {
  position: relative;
  width: 24px;
  height: 24px;
  border: 1px solid oklch(100% 0 0 / 0.26);
  border-radius: 999px;
  background: oklch(100% 0 0 / 0.07);
  box-shadow: inset 0 1px 0 oklch(100% 0 0 / 0.16);
}

.toggle-indicator::after {
  content: "";
  position: absolute;
  left: 7px;
  top: 4px;
  width: 7px;
  height: 12px;
  border-right: 2px solid oklch(10% 0.04 260);
  border-bottom: 2px solid oklch(10% 0.04 260);
  opacity: 0;
  transform: rotate(42deg) scale(0.7);
  transform-origin: center;
  transition: opacity 160ms ease, transform 160ms ease;
}

.tld-toggle.selected,
.rdap-toggle.selected {
  border-color: oklch(83% 0.145 205 / 0.88);
  background:
    linear-gradient(135deg, oklch(83% 0.145 205 / 0.27), oklch(72% 0.18 300 / 0.15)),
    oklch(100% 0 0 / 0.10);
  box-shadow:
    inset 3px 0 0 var(--nh-cyan),
    inset 0 1px 0 oklch(100% 0 0 / 0.34),
    0 0 0 1px oklch(83% 0.145 205 / 0.16),
    0 14px 34px oklch(83% 0.145 205 / 0.16);
  opacity: 1;
}

.tld-toggle.selected .toggle-indicator,
.rdap-toggle.selected .toggle-indicator {
  border-color: transparent;
  background: linear-gradient(135deg, var(--nh-cyan), var(--nh-lime));
  box-shadow: 0 0 18px oklch(83% 0.145 205 / 0.30);
}

.tld-toggle.selected .toggle-indicator::after,
.rdap-toggle.selected .toggle-indicator::after {
  opacity: 1;
  transform: rotate(42deg) scale(1);
}

.tld-toggle:hover,
.rdap-toggle:hover {
  transform: translateY(-1px);
  border-color: oklch(100% 0 0 / 0.30);
  opacity: 1;
}

.tld-toggle:focus-within,
.rdap-toggle:focus-within {
  outline: none;
  border-color: oklch(83% 0.145 205 / 0.86);
  box-shadow:
    0 0 0 3px oklch(83% 0.145 205 / 0.18),
    inset 0 1px 0 oklch(100% 0 0 / 0.22);
}

.rdap-toggle {
  margin-top: 8px;
}

.error-line {
  margin-top: 9px;
  color: oklch(83% 0.15 35);
  font-size: 0.84rem;
  font-weight: 700;
}

@media (max-width: 640px) {
  .command-panel {
    padding: 14px;
  }

  .panel-header,
  .search-row {
    flex-direction: column;
  }

  .scan-button {
    width: 100%;
  }

  .tld-panel {
    grid-template-columns: 1fr;
  }
}
</style>
