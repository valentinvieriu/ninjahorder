// DNS Provider Configuration
export interface ProviderConfig {
  name: string;
  baseUrl: string;
  formatUrl: (baseUrl: string, domain: string, type: number) => string;
  headers: Record<string, string>;
}

export const PROVIDERS: Record<string, ProviderConfig> = {
  'cloudflare': {
    name: 'Cloudflare',
    baseUrl: 'https://cloudflare-dns.com/dns-query',
    formatUrl: (baseUrl, domain, type) =>
      `${baseUrl}?name=${encodeURIComponent(domain)}&type=${type}`,
    headers: { 'Accept': 'application/dns-json' }
  },
  'quad9': {
    name: 'Quad9',
    baseUrl: 'https://dns.quad9.net:5053/dns-query',
    formatUrl: (baseUrl, domain, type) =>
      `${baseUrl}?name=${encodeURIComponent(domain)}&type=${type}`,
    headers: { 'Accept': 'application/dns-json' }
  },
  'google': {
    name: 'Google',
    baseUrl: 'https://dns.google/resolve',
    formatUrl: (baseUrl, domain, type) =>
      `${baseUrl}?name=${encodeURIComponent(domain)}&type=${type}`,
    headers: { 'Accept': 'application/dns-json' }
  }
};

// Provider URLs for easy access
export const DOH_PROVIDER_URLS = Object.values(PROVIDERS).map(p => p.baseUrl);

// Primary providers to use for domain checks
export const PRIMARY_PROVIDER_URLS = [
  PROVIDERS.cloudflare.baseUrl,
  PROVIDERS.google.baseUrl
];

// Timeout and retry settings
export const TIMEOUT_MS = 5000; // 5 seconds timeout
export const MAX_RETRIES = 1; // Maximum number of retries for transient network/timeout errors

// Known TLDs that frequently use wildcards
export const KNOWN_WILDCARD_TLDS = new Set([
  '.tk', '.ml', '.ga', '.cf', '.gq', // Freenom TLDs
  '.to', '.cc', '.ws', '.pw', // Several others known to use wildcards
]);

// Helper to get config based on URL
export const getProviderConfigFromUrl = (url: string): ProviderConfig | undefined => {
  return Object.values(PROVIDERS).find(p => url.startsWith(p.baseUrl));
}; 