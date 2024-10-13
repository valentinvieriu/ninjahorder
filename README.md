# NinjaHorder - Your Private Domain Scout

NinjaHorder is a stealthy domain availability checker built with Nuxt 3. It allows you to discreetly check the availability of multiple domain names across various Top-Level Domains (TLDs) without leaving a trace on domain registrars' servers.

## Why NinjaHorder?

Traditional domain searches often involve querying domain registrars directly, which can:
1. Leave a trace of your search history
2. Potentially influence domain pricing based on perceived interest
3. In some cases, lead to domain front-running

NinjaHorder takes a different approach:

- It uses DNS over HTTPS (DoH) to check domain availability directly from your browser
- This method is more discreet and doesn't interact with domain registrars' WHOIS servers
- It allows you to scout for domains without alerting registrars or potential competitors

## How It Works

NinjaHorder performs DNS lookups using Cloudflare's DNS over HTTPS API. By analyzing the DNS response, it can infer whether a domain is likely to be available or already registered.

**Note:** While this method is generally reliable, it's not 100% accurate. Some edge cases may produce false positives or negatives. Always double-check with a registrar before making purchase decisions.

## Features

- Check domain availability across multiple TLDs simultaneously
- Choose from popular, country-specific, and custom modern TLDs
- Stealth checking using DNS over HTTPS
- Fast, client-side processing
- Responsive design for desktop and mobile use

## Setup

Make sure to install the dependencies:

```bash
# npm
npm install

# pnpm
pnpm install

# yarn
yarn install

# bun
bun install
```

## Development Server

Start the development server on `http://localhost:3000`:

```bash
# npm
npm run dev

# pnpm
pnpm run dev

# yarn
yarn dev

# bun
bun run dev
```

## Production

Build the application for production:

```bash
# npm
npm run build

# pnpm
pnpm run build

# yarn
yarn build

# bun
bun run build
```

Locally preview production build:

```bash
# npm
npm run preview

# pnpm
pnpm run preview

# yarn
yarn preview

# bun
bun run preview
```

Check out the [deployment documentation](https://nuxt.com/docs/getting-started/deployment) for more information.
