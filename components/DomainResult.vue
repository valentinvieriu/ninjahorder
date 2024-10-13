<template>
  <div class="w-full max-w-md mt-4">
    <div v-if="results.available.length > 0">
      <h2 class="text-lg font-semibold mb-2 text-gray-800 dark:text-gray-200">Available Domains</h2>
      <div
        v-for="result in results.available"
        :key="result.domain"
        class="flex items-center justify-between p-2 mb-2 bg-white dark:bg-gray-700 rounded-md"
      >
        <a
          :href="result.link"
          target="_blank"
          rel="noopener noreferrer"
          class="text-gray-800 dark:text-gray-200 hover:underline"
          tabindex="0"
          :aria-label="`Visit ${result.domain}`"
        >
          {{ result.domain }}
        </a>
        <span
          class="ml-2 text-available-color"
          title="Available"
          aria-hidden="true"
        >
          ✅
        </span>
      </div>
    </div>

    <div v-if="results.notAvailable.length > 0" class="mt-4">
      <h2 class="text-lg font-semibold mb-2 text-gray-800 dark:text-gray-200">Not Available Domains</h2>
      <div
        v-for="result in results.notAvailable"
        :key="result.domain"
        class="flex items-center justify-between p-2 mb-2 bg-white dark:bg-gray-700 rounded-md"
      >
        <a
          :href="result.link"
          target="_blank"
          rel="noopener noreferrer"
          class="text-gray-800 dark:text-gray-200 hover:underline"
          tabindex="0"
          :aria-label="`Visit ${result.domain}`"
        >
          {{ result.domain }}
        </a>
        <span
          :class="[
            'ml-2',
            result.error ? 'text-gray-500 dark:text-gray-400' : 'text-error-color'
          ]"
          :title="result.error ? 'Error checking domain' : 'Unavailable'"
          aria-hidden="true"
        >
          {{ result.error ? '❓' : '❌' }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { toRefs } from 'vue'

const props = defineProps({
  results: {
    type: Object,
    required: true,
  },
})

const { results } = toRefs(props)
</script>
