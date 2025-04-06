<template>
  <div class="container mx-auto px-4 py-8">
    <h1 class="text-3xl font-bold mb-8 text-center">Domain Availability Checker</h1>
    <DomainForm :initialData="initialFormData" @submit="handleSubmit" />
    <div v-if="isChecking" class="mt-8 space-y-4">
      <div class="flex justify-between items-center">
        <p class="text-sm font-semibold text-gray-600">{{ stageMessages[progress.stage] }}</p>
        <p class="text-sm font-medium">{{ progress.domainsProcessed }} / {{ progress.totalDomains }} domains</p>
      </div>
      
      <div class="w-full bg-gray-200 rounded-full h-2.5">
        <div class="bg-blue-600 h-2.5 rounded-full transition-all duration-300" :style="{ width: `${progress.percentage}%` }"></div>
      </div>
      
      <!-- Provider status indicators -->
      <div v-if="progress.providers && progress.providers.length > 0" class="flex flex-wrap gap-2 mt-2">
        <div 
          v-for="provider in activeProviders" 
          :key="provider.name"
          class="px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1"
          :class="providerStatusClass(provider)"
        >
          <span v-if="provider.status === 'active'" class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
          <span v-else-if="provider.status === 'failed'" class="w-2 h-2 rounded-full bg-red-500"></span>
          <span v-else class="w-2 h-2 rounded-full bg-gray-500"></span>
          {{ provider.name }}
        </div>
      </div>
      
      <!-- Current domain status -->
      <div class="mt-3">
        <div v-if="progress.currentDomain" class="text-center p-2 bg-gray-100 dark:bg-gray-800 rounded-md">
          <p class="font-medium">
            {{ progress.detailedMessage || `Checking ${progress.currentDomain}...` }}
          </p>
        </div>
        <div v-else-if="progress.detailedMessage" class="text-center p-2 bg-gray-100 dark:bg-gray-800 rounded-md">
          <p class="font-medium">{{ progress.detailedMessage }}</p>
        </div>
        <div v-else class="text-center text-gray-500">
          {{ Math.round(progress.percentage) }}% complete
        </div>
      </div>
      
      <!-- Error messages -->
      <div v-if="progress.errors && progress.errors.length > 0" class="mt-3 bg-red-100 border border-red-300 text-red-800 p-3 rounded-md">
        <h3 class="font-semibold text-sm mb-1">Issues detected:</h3>
        <ul class="list-disc pl-5 text-sm space-y-1">
          <li v-for="(error, index) in progress.errors" :key="index">
            {{ error }}
          </li>
        </ul>
      </div>
    </div>
    <div v-else-if="hasResults" class="mt-8 space-y-4">
      <h2 class="text-2xl font-semibold mb-4">Results:</h2>
      <div v-if="results.available.length > 0">
        <h3 class="text-xl font-semibold mb-2">Available Domains:</h3>
        <DomainResult v-for="result in results.available" :key="result.domain" :result="result" />
      </div>
      <div v-if="results.premium.length > 0">
        <h3 class="text-xl font-semibold mb-2">Premium Domains:</h3>
        <DomainResult v-for="result in results.premium" :key="result.domain" :result="result" />
      </div>
      <div v-if="results.notAvailable.length > 0">
        <h3 class="text-xl font-semibold mb-2">Unavailable Domains:</h3>
        <DomainResult v-for="result in results.notAvailable" :key="result.domain" :result="result" />
      </div>
      <div v-if="results.other?.length > 0">
        <h3 class="text-xl font-semibold mb-2">Indeterminate/Error Domains:</h3>
        <DomainResult v-for="result in results.other" :key="result.domain" :result="result" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useDomainCheck, stageMessages } from '~/composables/useDomainCheck'
import { PROVIDERS } from '~/config/appConfig'

const { checkDomains, groupedResults, progress, isChecking } = useDomainCheck()
const results = groupedResults

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

// Create a list of providers with their status
const activeProviders = computed(() => {
  const providerList = Object.values(PROVIDERS).map(provider => ({
    name: provider.name,
    baseUrl: provider.baseUrl,
    status: 'inactive' // Default status
  }))
  
  // Update with status from progress if available
  if (progress.value.providers && progress.value.providers.length > 0) {
    progress.value.providers.forEach((providerStatus: { url: string, active: boolean }) => {
      const provider = providerList.find(p => p.baseUrl === providerStatus.url)
      if (provider) {
        provider.status = providerStatus.active ? 'active' : 'failed'
      }
    })
  }
  
  return providerList
})

// CSS classes for provider status badges
const providerStatusClass = (provider: { status: string }) => {
  switch (provider.status) {
    case 'active':
      return 'bg-green-100 text-green-800 border border-green-200'
    case 'failed':
      return 'bg-red-100 text-red-800 border border-red-200'
    default:
      return 'bg-gray-100 text-gray-800 border border-gray-200'
  }
}

const handleSubmit = async (data: { domain: string, tlds: string[] }) => {
  await checkDomains(data.domain, data.tlds)
}
</script>
