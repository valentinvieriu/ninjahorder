<template>
  <div class="gradient-container">
    <div 
      class="fixed inset-0 z-[-1]" 
      :style="{ background: gradientStyle, backgroundSize: '400% 400%', animation: 'gradientAnimation 15s ease infinite' }"
    ></div>
    <div class="content-wrapper">
      <NuxtPage />
    </div>
  </div>
</template>

<script setup>
import { useRandomGradient } from '~/composables/useRandomGradient'

const { gradientStyle } = useRandomGradient()
</script>

<style>
@keyframes gradientAnimation {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

html, body {
  height: 100%;
  margin: 0;
  padding: 0;
}

.gradient-container {
  min-height: 100vh;
  width: 100%;
  overflow-y: auto;
  overflow-x: hidden;
}

.content-wrapper {
  position: relative;
  z-index: 1;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}
</style>
