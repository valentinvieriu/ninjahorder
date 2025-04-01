<template>
  <div class="container mx-auto px-4 py-8">
    <h1 class="text-3xl font-bold mb-8 text-center">Domain Availability Checker</h1>
    <DomainForm :initialData="initialFormData" @submit="handleSubmit" />
    <div v-if="isChecking" class="mt-8">
      <p class="text-center">Checking domains... {{ Math.round(progress) }}%</p>
      <div class="w-full bg-gray-200 rounded-full h-2.5 mt-2">
        <div class="bg-blue-600 h-2.5 rounded-full" :style="{ width: `${progress}%` }"></div>
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
import { useDomainCheck } from '~/composables/useDomainCheck'

const { checkDomains, groupedResults, progress, isChecking } = useDomainCheck()
const results = groupedResults

const initialFormData = ref({
  domain: '',
  popularTLDs: false,
  countryTLDs: false,
  customTLDs: false,
})

const hasResults = computed(() => 
  results.value.available.length > 0 || 
  results.value.premium.length > 0 ||
  results.value.notAvailable.length > 0 || 
  results.value.other.length > 0
)

const handleSubmit = async (data: { domain: string, tlds: string[] }) => {
  await checkDomains(data.domain, data.tlds)
}
</script>
