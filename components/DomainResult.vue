<template>
  <div class="flex items-center justify-between p-4 bg-white rounded-lg shadow-md mb-4">
    <div class="flex items-center space-x-4">
      <div :class="[
        'w-4 h-4 rounded-full',
        result.available ? 'bg-green-500' : 'bg-red-500'
      ]"></div>
      <span class="text-lg font-semibold">{{ result.domain }}</span>
    </div>
    <div class="flex items-center space-x-4">
      <div class="relative w-32 group">
        <div class="w-full bg-gray-200 rounded-full h-2.5">
          <div
            class="h-2.5 rounded-full"
            :style="{ width: `${result.confidence}%`, backgroundColor: confidenceColor }"
          ></div>
        </div>
        <div class="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 p-2 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
          Confidence: {{ result.confidence }}%
          <ul v-if="result.confidenceReasons.length > 0" class="mt-1 list-disc list-inside">
            <li v-for="reason in result.confidenceReasons" :key="reason">{{ reason }}</li>
          </ul>
          <span v-if="result.available" class="text-green-500">Likely available</span>
          <span v-else class="text-red-500">Likely registered</span>
        </div>
      </div>
      <a
        :href="result.link"
        target="_blank"
        rel="noopener noreferrer"
        class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors duration-300"
      >
        {{ result.available ? 'Register' : 'Visit' }}
      </a>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  result: {
    domain: string
    available: boolean
    error: boolean
    link: string
    confidence: number
    confidenceReasons: string[]
  }
}>()

const confidenceColor = computed(() => {
  if (props.result.confidence > 80) return '#22c55e' // green-500
  if (props.result.confidence > 60) return '#eab308' // yellow-500
  if (props.result.confidence > 40) return '#f97316' // orange-500
  return '#ef4444' // red-500
})
</script>
