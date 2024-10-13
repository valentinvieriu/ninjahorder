<template>
  <div class="container mx-auto p-4 min-h-screen flex flex-col items-center">
    <h1 class="text-2xl font-bold text-center mb-6 text-gray-800 dark:text-gray-200">
      NinjaHorder - Your Private Domain Scout
    </h1>
    <DomainForm @submit="handleSubmit" :initialData="formData" />
    <div v-if="isChecking" class="w-full max-w-md mt-4">
      <div class="bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
        <div class="bg-blue-600 h-2.5 rounded-full" :style="{ width: `${progress}%` }"></div>
      </div>
      <p class="text-center mt-2 text-sm text-gray-600 dark:text-gray-400">
        Checking domains: {{ Math.round(progress) }}%
      </p>
    </div>
    <DomainResult :results="results" />
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import DomainForm from '~/components/DomainForm.vue'
import DomainResult from '~/components/DomainResult.vue'
import { useDomainCheck } from '~/composables/useDomainCheck'
import { popularTLDs, countryTLDs, customTLDs } from '~/utils/tlds'

const { checkDomains, results, progress, isChecking } = useDomainCheck()

const router = useRouter()
const route = useRoute()

const formData = ref({
  domain: '',
  popularTLDs: false,
  countryTLDs: false,
  customTLDs: false,
})

const updateFormDataFromQuery = () => {
  const { domain, tldTypes } = route.query
  if (typeof domain === 'string' && typeof tldTypes === 'string') {
    const tldTypesList = tldTypes.split(',')
    formData.value = {
      domain: domain.toLowerCase(),
      popularTLDs: tldTypesList.includes('popular'),
      countryTLDs: tldTypesList.includes('country'),
      customTLDs: tldTypesList.includes('custom'),
    }
    return true
  }
  return false
}

const handleSubmit = async (data) => {
  const { domain, popularTLDs: popular, countryTLDs: country, customTLDs: custom } = data
  const selectedTLDs = []

  if (!domain) return

  if (popular) selectedTLDs.push(...popularTLDs)
  if (country) selectedTLDs.push(...countryTLDs)
  if (custom) selectedTLDs.push(...customTLDs)

  await checkDomains(domain.toLowerCase(), selectedTLDs)

  // Update URL with query parameters for bookmarking and history
  router.push({
    query: {
      domain: domain.toLowerCase(),
      tldTypes: [
        popular && 'popular',
        country && 'country',
        custom && 'custom'
      ].filter(Boolean).join(',')
    }
  })
}

onMounted(() => {
  if (updateFormDataFromQuery()) {
    handleSubmit(formData.value)
  }
})

// Watch for route changes to update form data and trigger new checks
watch(() => route.query, () => {
  if (updateFormDataFromQuery()) {
    handleSubmit(formData.value)
  }
}, { immediate: true, deep: true })
</script>
