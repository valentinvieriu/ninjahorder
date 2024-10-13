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
          class="w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-button-bg"
          aria-label="Domain name"
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
        aria-label="Check domain availability"
      >
        Check
      </button>
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
    </div>
  </form>
</template>

<script setup>
import { ref, watch } from 'vue'

const emit = defineEmits(['submit'])

const props = defineProps({
  initialData: {
    type: Object,
    required: true,
  },
})

const domain = ref(props.initialData.domain)
const popularTLDsChecked = ref(props.initialData.popularTLDs)
const countryTLDsChecked = ref(props.initialData.countryTLDs)
const customTLDsChecked = ref(props.initialData.customTLDs)

watch(() => props.initialData, (newValue) => {
  domain.value = newValue.domain
  popularTLDsChecked.value = newValue.popularTLDs
  countryTLDsChecked.value = newValue.countryTLDs
  customTLDsChecked.value = newValue.customTLDs
}, { deep: true })

const handleSubmit = () => {
  emit('submit', {
    domain: domain.value,
    popularTLDs: popularTLDsChecked.value,
    countryTLDs: countryTLDsChecked.value,
    customTLDs: customTLDsChecked.value,
  })
}

const handleReset = () => {
  domain.value = ''
}
</script>
