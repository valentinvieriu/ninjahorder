<template>
  <div class="flex items-center justify-between p-4 bg-white rounded-lg shadow-md mb-4">
    <div class="flex items-center space-x-4">
      <div :class="[
        'w-4 h-4 rounded-full',
        statusColorClass
      ]"></div>
      <span class="text-lg font-semibold">{{ result.domain }}</span>
    </div>
    <div class="flex items-center space-x-4">
      <div class="relative group">
        <div class="px-3 py-1 text-xs font-medium rounded-full" :class="statusBadgeClass">
          {{ statusText }}
        </div>
        <div class="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 p-2 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap z-10 w-64">
          Status: {{ statusText }}
          <ul v-if="result.confidenceReasons.length > 0" class="mt-1 list-disc list-inside">
            <li v-for="reason in result.confidenceReasons" :key="reason" class="whitespace-normal">{{ reason }}</li>
          </ul>
          <div v-if="result.dnssecValidated" class="text-blue-400 mt-1">DNSSEC Validated</div>
          <div v-if="result.wildcardDetected" class="text-orange-400 mt-1">Wildcard DNS Detected</div>
        </div>
      </div>
      <a
        :href="result.link"
        target="_blank"
        rel="noopener noreferrer"
        class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors duration-300"
        :class="{ 'opacity-50 cursor-not-allowed': result.status === 'error' || result.status === 'indeterminate' }"
      >
        {{ buttonText }}
      </a>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { DomainAvailabilityStatus } from '~/composables/useDomainCheck'

const props = defineProps<{
  result: {
    domain: string
    status: DomainAvailabilityStatus
    error: boolean
    link: string
    confidenceReasons: string[]
    dnssecValidated?: boolean
    wildcardDetected?: boolean
  }
}>()

const statusColorClass = computed(() => {
  switch (props.result.status) {
    case DomainAvailabilityStatus.AVAILABLE: 
      return 'bg-green-500'
    case DomainAvailabilityStatus.REGISTERED: 
      return 'bg-red-500'
    case DomainAvailabilityStatus.PREMIUM: 
      return 'bg-purple-500'
    case DomainAvailabilityStatus.INDETERMINATE: 
      return 'bg-yellow-500'
    case DomainAvailabilityStatus.ERROR:
    default:
      return 'bg-gray-500'
  }
})

const statusBadgeClass = computed(() => {
  switch (props.result.status) {
    case DomainAvailabilityStatus.AVAILABLE: 
      return 'bg-green-100 text-green-800'
    case DomainAvailabilityStatus.REGISTERED: 
      return 'bg-red-100 text-red-800'
    case DomainAvailabilityStatus.PREMIUM: 
      return 'bg-purple-100 text-purple-800'
    case DomainAvailabilityStatus.INDETERMINATE: 
      return 'bg-yellow-100 text-yellow-800'
    case DomainAvailabilityStatus.ERROR:
    default:
      return 'bg-gray-100 text-gray-800'
  }
})

const statusText = computed(() => {
  switch (props.result.status) {
    case DomainAvailabilityStatus.AVAILABLE: 
      return 'Available'
    case DomainAvailabilityStatus.REGISTERED: 
      return 'Registered'
    case DomainAvailabilityStatus.PREMIUM: 
      return 'Premium Domain'
    case DomainAvailabilityStatus.INDETERMINATE: 
      return 'Indeterminate'
    case DomainAvailabilityStatus.ERROR:
      return 'Error'
    default:
      return 'Unknown'
  }
})

const buttonText = computed(() => {
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
