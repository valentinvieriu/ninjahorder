<script setup>
import { ref, reactive } from 'vue';
import { DohResolver } from '~/utils/DohResolver';

const domain = ref('');
const results = reactive({
  cloudflare: null,
  google: null,
  quad9: null
});
const loading = ref(false);
const error = ref('');

const providers = {
  cloudflare: 'https://cloudflare-dns.com/dns-query',
  google: 'https://dns.google/resolve',
  quad9: 'https://dns.quad9.net:5053/dns-query'
};

const checkDomain = async () => {
  if (!domain.value) {
    error.value = 'Please enter a domain name';
    return;
  }

  loading.value = true;
  error.value = '';
  
  // Reset results
  results.cloudflare = null;
  results.google = null;
  results.quad9 = null;
  
  try {
    const domainName = domain.value.toLowerCase().trim();
    
    // Check each provider in parallel
    await Promise.all(Object.entries(providers).map(async ([key, url]) => {
      try {
        const resolver = new DohResolver(url);
        const headers = key === 'google' ? {} : { 'Accept': 'application/dns-json' };
        
        // Check for NS records (type 2)
        const response = await resolver.query(domainName, 'NS', 'GET', headers);
        results[key] = response;
      } catch (err) {
        results[key] = { error: err.message, Status: -1 };
      }
    }));
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
};

const getStatusText = (status) => {
  if (status === undefined || status === null) return 'Unknown';
  
  switch (status) {
    case 0: return 'NOERROR (Domain exists)';
    case 3: return 'NXDOMAIN (Domain available)';
    case 2: return 'SERVFAIL (Server failure)';
    case 1: return 'FORMERR (Format error)';
    case 4: return 'NOTIMP (Not implemented)';
    case 5: return 'REFUSED (Query refused)';
    case -1: return 'ERROR';
    default: return `Status code: ${status}`;
  }
};

const getResultColor = (status) => {
  if (status === undefined || status === null) return 'bg-gray-100';
  
  switch (status) {
    case 0: return 'bg-red-100'; // Domain exists (not available)
    case 3: return 'bg-green-100'; // Domain available
    case -1: return 'bg-yellow-100'; // Error
    default: return 'bg-orange-100'; // Other status codes
  }
};

const getDomainStatus = () => {
  const statuses = Object.values(results)
    .filter(r => r !== null)
    .map(r => r.Status);
  
  if (statuses.length === 0) return 'Unknown';
  
  // If any provider returns NOERROR (0), domain exists
  if (statuses.includes(0)) return 'Registered';
  
  // If all providers return NXDOMAIN (3), domain is available
  if (statuses.every(s => s === 3)) return 'Available';
  
  // Otherwise inconclusive or error
  return 'Inconclusive';
};

const getDomainStatusColor = () => {
  const status = getDomainStatus();
  
  switch (status) {
    case 'Available': return 'text-green-600 font-bold';
    case 'Registered': return 'text-red-600 font-bold';
    case 'Inconclusive': return 'text-orange-600 font-bold';
    default: return 'text-gray-600';
  }
};
</script>

<template>
  <div class="p-4 max-w-3xl mx-auto">
    <h1 class="text-2xl font-bold mb-4">Domain Availability Test (DohResolver)</h1>
    
    <div class="mb-6">
      <div class="flex">
        <input 
          v-model="domain" 
          type="text" 
          placeholder="Enter domain name (e.g., example.com)" 
          class="flex-grow px-4 py-2 border rounded-l focus:outline-none focus:ring-2 focus:ring-blue-500"
          @keyup.enter="checkDomain"
        />
        <button 
          @click="checkDomain" 
          class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-r"
          :disabled="loading"
        >
          <span v-if="loading">Checking...</span>
          <span v-else>Check</span>
        </button>
      </div>
      <p v-if="error" class="text-red-500 mt-2">{{ error }}</p>
    </div>
    
    <div v-if="Object.values(results).some(r => r !== null)" class="mb-6">
      <div class="text-xl mb-2">
        Domain Status: <span :class="getDomainStatusColor()">{{ getDomainStatus() }}</span>
      </div>
      
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
        <div 
          v-for="(result, provider) in results" 
          :key="provider"
          :class="['border rounded p-4', result ? getResultColor(result.Status) : 'bg-gray-100']"
        >
          <h3 class="font-bold capitalize mb-2">{{ provider }}</h3>
          
          <div v-if="result">
            <div class="mb-1">
              <span class="font-semibold">Status:</span> {{ getStatusText(result.Status) }}
            </div>
            
            <div v-if="result.Answer && result.Answer.length > 0" class="mt-2">
              <div class="font-semibold">NS Records:</div>
              <ul class="list-disc list-inside">
                <li v-for="(record, i) in result.Answer" :key="i" class="text-sm">
                  {{ record.data }}
                </li>
              </ul>
            </div>
            
            <div v-if="result.Authority && result.Authority.length > 0" class="mt-2">
              <div class="font-semibold">Authority Records:</div>
              <ul class="list-disc list-inside">
                <li v-for="(record, i) in result.Authority" :key="i" class="text-sm">
                  {{ record.data }}
                </li>
              </ul>
            </div>
            
            <div v-if="result.error" class="mt-2 text-red-500">
              Error: {{ result.error }}
            </div>
          </div>
          
          <div v-else class="text-gray-500 italic">
            No result yet
          </div>
        </div>
      </div>
    </div>
  </div>
</template> 