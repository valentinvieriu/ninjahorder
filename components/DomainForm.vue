<template>
  <form @submit.prevent="handleSubmit" class="glass-panel command-panel">
    <div class="panel-header">
      <div>
        <p class="eyebrow">Private DNS Scout</p>
        <h2>Scan a domain stem</h2>
      </div>
      <div class="privacy-chip">
        <span></span>
        Browser-only checks
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

    <div class="selection-header">
      <div>
        <p class="section-kicker">Scope</p>
        <h3>Choose TLD bundles</h3>
      </div>
      <span>{{ selectedZoneCount }} zones</span>
    </div>

    <div class="tld-panel" aria-label="TLD groups">
      <label class="tld-toggle popular" :class="{ selected: popularTLDsChecked }">
        <input
          type="checkbox"
          v-model="popularTLDsChecked"
          aria-label="Include popular TLDs"
        />
        <span class="toggle-copy">
          <span class="toggle-title">Popular</span>
          <small>High-demand everyday and startup endings.</small>
          <span class="sample-tlds">
            <span>.com</span>
            <span>.io</span>
            <span>.app</span>
            <span>.ai</span>
          </span>
        </span>
        <span class="zone-count">{{ popularTLDs.length }}</span>
        <span class="toggle-indicator" aria-hidden="true"></span>
      </label>

      <label class="tld-toggle country" :class="{ selected: countryTLDsChecked }">
        <input
          type="checkbox"
          v-model="countryTLDsChecked"
          aria-label="Include country TLDs"
        />
        <span class="toggle-copy">
          <span class="toggle-title">Country</span>
          <small>
            Regional
            <span
              class="term-help inline"
              tabindex="0"
              title="Country-code top-level domains, such as .de, .uk, or .jp."
              aria-label="ccTLD means country-code top-level domain, such as .de, .uk, or .jp."
              data-tip="Country-code top-level domains, such as .de, .uk, or .jp."
            >ccTLD</span>
            coverage for local markets.
          </small>
          <span class="sample-tlds">
            <span>.de</span>
            <span>.uk</span>
            <span>.us</span>
            <span>.jp</span>
          </span>
        </span>
        <span class="zone-count">{{ countryTLDs.length }}</span>
        <span class="toggle-indicator" aria-hidden="true"></span>
      </label>

      <label class="tld-toggle modern" :class="{ selected: customTLDsChecked }">
        <input
          type="checkbox"
          v-model="customTLDsChecked"
          aria-label="Include custom modern TLDs"
        />
        <span class="toggle-copy">
          <span class="toggle-title">Modern</span>
          <small>Brandable newer endings and niche names.</small>
          <span class="sample-tlds">
            <span>.shop</span>
            <span>.design</span>
            <span>.studio</span>
            <span>.fun</span>
          </span>
        </span>
        <span class="zone-count">{{ customTLDs.length }}</span>
        <span class="toggle-indicator" aria-hidden="true"></span>
      </label>
    </div>

    <div v-if="!isTldSelected" class="error-line">
      Select at least one TLD group.
    </div>

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
  }
}>()

const emit = defineEmits(['submit'])

const domain = ref(props.initialData.domain)
const popularTLDsChecked = ref(props.initialData.popularTLDs)
const countryTLDsChecked = ref(props.initialData.countryTLDs)
const customTLDsChecked = ref(props.initialData.customTLDs)
const domainError = ref('')

watch(() => props.initialData, (newValue) => {
  domain.value = newValue.domain
  popularTLDsChecked.value = newValue.popularTLDs
  countryTLDsChecked.value = newValue.countryTLDs
  customTLDsChecked.value = newValue.customTLDs
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

const selectedZoneCount = computed(() => {
  let count = 0
  if (popularTLDsChecked.value) count += popularTLDs.length
  if (countryTLDsChecked.value) count += countryTLDs.length
  if (customTLDsChecked.value) count += customTLDs.length
  return count
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
    tlds: uniqueTLDs
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
.selection-header,
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
  display: inline-flex;
  align-items: center;
  gap: 7px;
  flex: 0 0 auto;
  padding-top: 4px;
  color: oklch(86% 0.055 205);
  font-size: 0.74rem;
  font-weight: 800;
  white-space: nowrap;
}

.privacy-chip span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--nh-lime);
  box-shadow: 0 0 12px var(--nh-lime);
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

.selection-header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid oklch(100% 0 0 / 0.11);
}

.section-kicker {
  margin: 0 0 3px;
  color: oklch(91% 0.11 78);
  font-size: 0.68rem;
  font-weight: 900;
  text-transform: uppercase;
}

.selection-header h3 {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  color: var(--nh-text);
  font-size: 0.98rem;
  line-height: 1.15;
}

.term-help {
  position: relative;
  z-index: 5;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: 1px solid oklch(100% 0 0 / 0.18);
  border-radius: 999px;
  color: oklch(91% 0.11 78);
  background: oklch(100% 0 0 / 0.07);
  font-size: 0.7rem;
  font-weight: 900;
  cursor: help;
}

.term-help.inline {
  width: auto;
  height: auto;
  padding: 0 3px;
  border-radius: 4px;
  font-size: inherit;
  line-height: 1.15;
}

.term-help::after {
  content: attr(data-tip);
  position: absolute;
  left: 0;
  bottom: calc(100% + 8px);
  z-index: 60;
  width: min(270px, calc(100vw - 32px));
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
}

.term-help:hover::after,
.term-help:focus::after,
.term-help:focus-visible::after {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
}

.selection-header > span {
  flex: 0 0 auto;
  padding: 5px 9px;
  border: 1px solid oklch(100% 0 0 / 0.14);
  border-radius: 999px;
  color: var(--nh-text);
  background: oklch(100% 0 0 / 0.08);
  font-size: 0.74rem;
  font-weight: 900;
}

.tld-panel {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 10px;
}

.tld-toggle {
  --facet-accent: var(--nh-cyan);
  --facet-shadow: oklch(83% 0.145 205 / 0.18);
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 26px;
  gap: 10px;
  align-items: start;
  min-height: 132px;
  padding: 13px;
  border: 1px solid oklch(100% 0 0 / 0.14);
  border-radius: var(--nh-radius);
  color: var(--nh-muted);
  background:
    linear-gradient(145deg, oklch(100% 0 0 / 0.08), transparent 52%),
    oklch(8% 0.035 260 / 0.40);
  box-shadow: inset 0 2px 0 color-mix(in oklch, var(--facet-accent), transparent 48%);
  cursor: pointer;
  opacity: 0.72;
  transition: transform 180ms ease, border-color 180ms ease, background 180ms ease, color 180ms ease, opacity 180ms ease, box-shadow 180ms ease;
}

.tld-toggle.popular {
  --facet-accent: var(--nh-cyan);
  --facet-shadow: oklch(83% 0.145 205 / 0.18);
}

.tld-toggle.country {
  --facet-accent: var(--nh-amber);
  --facet-shadow: oklch(82% 0.16 78 / 0.18);
}

.tld-toggle.modern {
  --facet-accent: var(--nh-violet);
  --facet-shadow: oklch(72% 0.18 300 / 0.18);
}

.tld-toggle::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  background:
    linear-gradient(90deg, var(--facet-shadow), transparent 54%),
    linear-gradient(180deg, oklch(100% 0 0 / 0.06), transparent 42%);
  opacity: 0.72;
}

.tld-toggle input {
  position: absolute;
  inset: 0;
  z-index: 3;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

.toggle-copy {
  display: grid;
  gap: 7px;
  min-width: 0;
  position: relative;
  z-index: 1;
}

.toggle-title {
  color: var(--nh-text);
  font-size: 1rem;
  font-weight: 900;
}

.tld-toggle small {
  color: oklch(82% 0.04 245 / 0.78);
  font-size: 0.78rem;
  font-weight: 700;
  line-height: 1.35;
}

.sample-tlds {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 3px;
}

.sample-tlds span {
  padding: 3px 6px;
  border: 1px solid color-mix(in oklch, var(--facet-accent), transparent 68%);
  border-radius: 999px;
  color: oklch(94% 0.03 245);
  background: color-mix(in oklch, var(--facet-accent), transparent 90%);
  font-size: 0.7rem;
  font-weight: 900;
}

.zone-count {
  position: relative;
  z-index: 1;
  padding: 4px 8px;
  border: 1px solid color-mix(in oklch, var(--facet-accent), transparent 66%);
  border-radius: 999px;
  color: color-mix(in oklch, var(--facet-accent), white 24%);
  background: color-mix(in oklch, var(--facet-accent), transparent 88%);
  font-size: 0.74rem;
  font-weight: 900;
}

.toggle-indicator {
  position: relative;
  z-index: 1;
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

.tld-toggle.selected {
  border-color: color-mix(in oklch, var(--facet-accent), white 18%);
  background:
    linear-gradient(135deg, var(--facet-shadow), oklch(100% 0 0 / 0.08)),
    oklch(100% 0 0 / 0.10);
  box-shadow:
    inset 0 3px 0 var(--facet-accent),
    inset 0 1px 0 oklch(100% 0 0 / 0.34),
    0 0 0 1px var(--facet-shadow),
    0 14px 34px var(--facet-shadow);
  opacity: 1;
}

.tld-toggle.selected .toggle-indicator {
  border-color: transparent;
  background: linear-gradient(135deg, var(--facet-accent), var(--nh-lime));
  box-shadow: 0 0 18px var(--facet-shadow);
}

.tld-toggle.selected .toggle-indicator::after {
  opacity: 1;
  transform: rotate(42deg) scale(1);
}

.tld-toggle:hover {
  transform: translateY(-1px);
  border-color: oklch(100% 0 0 / 0.30);
  opacity: 1;
}

.tld-toggle:focus-within {
  outline: none;
  border-color: color-mix(in oklch, var(--facet-accent), white 18%);
  box-shadow:
    0 0 0 3px var(--facet-shadow),
    inset 0 1px 0 oklch(100% 0 0 / 0.22);
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

  .selection-header {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
