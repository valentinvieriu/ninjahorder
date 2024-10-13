<template>
  <div
    class="gradient-bg min-h-screen flex flex-col justify-center items-center overflow-x-hidden"
  >
    <NuxtPage />
  </div>
</template>

<script setup>
// No additional script needed for the default layout
</script>

<style>
.gradient-bg {
  @apply bg-gradient-to-r from-pink-300 via-blue-200 to-green-200;
  background-size: 400% 400%;
  animation: gradientAnimation 15s ease infinite;
}
</style>
