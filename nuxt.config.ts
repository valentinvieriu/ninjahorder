// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2024-04-03',
  devtools: { enabled: true },

  nitro: {
    preset: "./cloudflare-preset"
  },

  modules: ["nitro-cloudflare-dev", '@nuxtjs/tailwindcss'],

  css: [],

  app: {
    head: {
      title: 'NinjaHorder - Your Private Domain Scout',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { charset: 'utf-8' },
      ],
      link: [{ rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' }],
    },
  },
})
