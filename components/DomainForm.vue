<template>
  <form @submit.prevent="handleSubmit" class="space-y-4">
    <div class="flex items-center space-x-2">
      <div class="relative flex-grow">
        <input
          v-model="domain"
          type="text"
          id="domain"
          name="domain"
          required
          placeholder="Enter domain name (without TLD)"
          class="w-full p-2 border rounded-md focus:outline-none focus:ring-2"
          :class="[
            domainError ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-button-bg'
          ]"
          aria-label="Domain name"
          @input="validateDomain"
        />
        <button
          type="button"
          @click="handleReset"
          title="Clear"
          class="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
          v-if="domain"
          aria-label="Clear domain name"
        >
          ✕
        </button>
      </div>
      <button
        type="submit"
        class="bg-button-bg hover:bg-button-hover-bg text-white font-bold py-2 px-4 rounded transition duration-300"
        :disabled="!isFormValid"
        :class="{ 'opacity-50 cursor-not-allowed': !isFormValid }"
        aria-label="Check domain availability"
      >
        Check
      </button>
    </div>
    
    <div v-if="domainError" class="text-red-500 text-sm mt-1 ml-1">
      {{ domainError }}
    </div>

    <div class="bg-white bg-opacity-50 dark:bg-gray-700 dark:bg-opacity-50 rounded-md p-4 space-y-2">
      <div>
        <label class="inline-flex items-center">
          <input
            type="checkbox"
            v-model="popularTLDsChecked"
            class="form-checkbox text-button-bg"
            aria-label="Include popular TLDs"
          />
          <span class="ml-2 text-gray-700 dark:text-gray-300">Popular TLDs</span>
        </label>
      </div>
      <div>
        <label class="inline-flex items-center">
          <input
            type="checkbox"
            v-model="countryTLDsChecked"
            class="form-checkbox text-button-bg"
            aria-label="Include country TLDs"
          />
          <span class="ml-2 text-gray-700 dark:text-gray-300">Country TLDs</span>
        </label>
      </div>
      <div>
        <label class="inline-flex items-center">
          <input
            type="checkbox"
            v-model="customTLDsChecked"
            class="form-checkbox text-button-bg"
            aria-label="Include custom modern TLDs"
          />
          <span class="ml-2 text-gray-700 dark:text-gray-300">Custom Modern TLDs</span>
        </label>
      </div>
      <div v-if="!isTldSelected" class="text-red-500 text-sm mt-1">
        Please select at least one TLD category
      </div>
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
  return domain.value.length > 0 && 
         !domainError.value && 
         isTldSelected.value
})

const validateDomain = () => {
  // Reset error
  domainError.value = ''
  
  // If empty, no validation needed
  if (!domain.value.trim()) return
  
  // Check for minimum length (at least 2 characters)
  if (domain.value.length < 2) {
    domainError.value = 'Domain name must be at least 2 characters'
    return
  }
  
  // Check for maximum length (63 characters as per DNS standards)
  if (domain.value.length > 63) {
    domainError.value = 'Domain name must be 63 characters or less'
    return
  }
  
  // Check for valid domain name characters (letters, numbers, and hyphens)
  // No dots allowed in the basic label
  const validDomainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/
  if (!validDomainRegex.test(domain.value)) {
    domainError.value = 'Domain name can only contain letters, numbers, and hyphens, and cannot start or end with a hyphen'
    return
  }
  
  // Check for dots which would indicate a full domain rather than just a label
  if (domain.value.includes('.')) {
    domainError.value = 'Please enter only the domain name without any TLD (no dots)'
    return
  }
}

const handleSubmit = () => {
  validateDomain()
  
  if (!isFormValid.value) return
  
  const selectedTLDs = []
  if (popularTLDsChecked.value) selectedTLDs.push(...popularTLDs)
  if (countryTLDsChecked.value) selectedTLDs.push(...countryTLDs)
  if (customTLDsChecked.value) selectedTLDs.push(...customTLDs)

  emit('submit', { domain: domain.value, tlds: selectedTLDs })
}

const handleReset = () => {
  domain.value = ''
  domainError.value = ''
}
</script>
