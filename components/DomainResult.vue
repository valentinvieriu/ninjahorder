<template>
  <div class="bg-white rounded-lg shadow-md mb-4 overflow-visible">
    <div class="grid grid-cols-12 p-4 gap-3 items-center">
      <!-- Domain and Status Information - left side -->
      <div class="col-span-6 flex items-center space-x-3">
        <div :class="[
          'w-4 h-4 rounded-full',
          statusColorClass
        ]"></div>
        <span class="text-lg font-semibold">{{ result.domain }}</span>
        
        <!-- Parked domain badges -->
        <div v-if="isParkedDomain" class="flex space-x-1">
          <span v-if="result.isParkedByNs" 
                class="px-2 py-0.5 text-xs font-medium rounded-full bg-orange-100 text-orange-800 border border-orange-300">
            NS-Parked
          </span>
          <span v-if="result.isParkedByTxt" 
                class="px-2 py-0.5 text-xs font-medium rounded-full bg-orange-100 text-orange-800 border border-orange-300">
            TXT-Parked
          </span>
        </div>
      </div>
      
      <!-- Status and Actions - right side -->
      <div class="col-span-6 flex items-center justify-end space-x-4">
        <div class="flex items-center space-x-2">
          <div class="px-3 py-1 text-xs font-medium rounded-full" :class="statusBadgeClass">
            <span>{{ statusText }}</span>
          </div>
          
          <!-- Info icon with tooltip - separated from status badge -->
          <div class="relative">
            <!-- Info icon button -->
            <button type="button" class="flex items-center justify-center w-6 h-6 rounded-full hover:bg-gray-200 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              
              <!-- Enhanced tooltip with wider width and table layout - Only shows on info icon hover -->
              <div class="absolute top-0 right-0 transform translate-y-[-100%] mt-[-8px] p-4 bg-gray-800 text-white text-sm rounded opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 z-50 w-96 shadow-lg max-h-[500px] overflow-y-auto pointer-events-none">
                <!-- Domain header -->
                <div class="font-medium mb-3 text-lg border-b border-gray-600 pb-2 flex items-center">
                  <span class="mr-2">{{ result.domain }}</span>
                  <span class="px-2 py-0.5 text-xs font-medium rounded-full" :class="statusBadgeClass">{{ statusText }}</span>
                </div>
                
                <!-- Table-like key metrics -->
                <div class="grid grid-cols-2 gap-2 mb-3">
                  <div class="bg-gray-700 p-2 rounded">
                    <div class="text-xs text-gray-400">Status</div>
                    <div class="font-medium">{{ statusText }}</div>
                  </div>
                  <div class="bg-gray-700 p-2 rounded">
                    <div class="text-xs text-gray-400">DNSSEC</div>
                    <div class="font-medium">{{ result.dnssecValidated ? 'Validated ✓' : 'Not validated' }}</div>
                  </div>
                  <div class="bg-gray-700 p-2 rounded">
                    <div class="text-xs text-gray-400">Wildcard DNS</div>
                    <div class="font-medium">{{ result.wildcardDetected ? 'Detected ⚠' : 'Not detected' }}</div>
                  </div>
                  <div class="bg-gray-700 p-2 rounded">
                    <div class="text-xs text-gray-400">Parking</div>
                    <div class="font-medium">{{ isParkedDomain ? `Detected (${parkingType})` : 'Not detected' }}</div>
                  </div>
                </div>
                
                <!-- Confidence reasons table -->
                <div v-if="result.confidenceReasons.length > 0" class="mb-3">
                  <div class="font-medium border-b border-gray-600 pb-1 mb-2">Analysis Steps</div>
                  <table class="w-full text-xs">
                    <tbody>
                      <template v-for="(reason, index) in formattedReasons" :key="index">
                        <tr :class="[
                          'border-b border-gray-700 last:border-0',
                          { 'bg-gray-700': reason.isSubItem }
                        ]">
                          <td class="py-1.5 pr-2 w-4">
                            <div v-if="!reason.isSubItem" 
                                :class="['w-3 h-3 rounded-full', 
                                  reason.isPositive ? 'bg-green-500' : 
                                  reason.isNegative ? 'bg-red-500' : 'bg-gray-400']">
                            </div>
                            <div v-else class="pl-2">→</div>
                          </td>
                          <td class="py-1.5 whitespace-normal">{{ reason.text }}</td>
                        </tr>
                      </template>
                    </tbody>
                  </table>
                </div>
                
                <!-- Additional information footer -->
                <div class="text-xs text-gray-400 border-t border-gray-600 pt-2 mt-2">
                  Click "{{ buttonText }}" for more information at {{ domainLinkHost }}
                </div>
              </div>
            </button>
          </div>
        </div>
        
        <a
          :href="domainLink"
          target="_blank"
          rel="noopener noreferrer"
          class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors duration-300"
          :class="{ 'opacity-50 cursor-not-allowed': result.status === 'error' || result.status === 'indeterminate' }"
        >
          {{ buttonText }}
        </a>
      </div>
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
    isParkedByNs: boolean
    isParkedByTxt: boolean
  }
}>()

const isParkedDomain = computed(() => {
  return props.result.isParkedByNs || props.result.isParkedByTxt
})

const parkingType = computed(() => {
  if (props.result.isParkedByNs && props.result.isParkedByTxt) return 'NS & TXT'
  if (props.result.isParkedByNs) return 'NS'
  if (props.result.isParkedByTxt) return 'TXT'
  return 'None'
})

const domainLink = computed(() => {
  // For parked domains, always use domainr.com for additional info
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
      return 'bg-green-500'
    case DomainAvailabilityStatus.REGISTERED: 
      return isParkedDomain.value ? 'bg-orange-500' : 'bg-red-500'
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
      return 'bg-green-100 text-green-800 border border-green-300'
    case DomainAvailabilityStatus.REGISTERED: 
      return isParkedDomain.value 
        ? 'bg-orange-100 text-orange-800 border border-orange-300'
        : 'bg-red-100 text-red-800 border border-red-300'
    case DomainAvailabilityStatus.PREMIUM: 
      return 'bg-purple-100 text-purple-800 border border-purple-300'
    case DomainAvailabilityStatus.INDETERMINATE: 
      return 'bg-yellow-100 text-yellow-800 border border-yellow-300'
    case DomainAvailabilityStatus.ERROR:
    default:
      return 'bg-gray-100 text-gray-800 border border-gray-300'
  }
})

const statusText = computed(() => {
  if (props.result.status === DomainAvailabilityStatus.REGISTERED && isParkedDomain.value) {
    return 'Registered (Parked)'
  }
  
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

const formattedReasons = computed(() => {
  return props.result.confidenceReasons.map(reason => {
    const isSubItem = reason.trim().startsWith('->') || reason.trim().startsWith(' ->')
    const text = isSubItem ? reason.replace(/^->\s*/, '') : reason
    
    // Determine if this is a positive or negative reason
    const isPositive = !isSubItem && (
      text.toLowerCase().includes('available') ||
      text.toLowerCase().includes('nxdomain') ||
      text.toLowerCase().includes('high confidence') && text.toLowerCase().includes('available')
    )
    
    const isNegative = !isSubItem && (
      text.toLowerCase().includes('registered') ||
      text.toLowerCase().includes('ns/soa records') ||
      text.toLowerCase().includes('parking') ||
      text.toLowerCase().includes('premium') ||
      text.toLowerCase().includes('error')
    )
    
    return { text, isSubItem, isPositive, isNegative }
  })
})

const buttonText = computed(() => {
  if (props.result.status === DomainAvailabilityStatus.REGISTERED && isParkedDomain.value) {
    return 'View Details'
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
/* Fix for tooltip positioning */
.relative:hover .group-hover\:opacity-100 {
  opacity: 1;
  visibility: visible;
}
</style>
