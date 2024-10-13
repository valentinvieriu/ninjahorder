export default defineEventHandler(async (event) => {
  const { domain } = getQuery(event)

  if (!domain || typeof domain !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Domain is required',
    })
  }

  const url = 'https://cloudflare-dns.com/dns-query'
  const params = new URLSearchParams({
    name: domain,
    type: 'A',
  })

  try {
    const data = await $fetch(`${url}?${params.toString()}`, {
      method: 'GET',
      headers: {
        Accept: 'application/dns-json',
      },
    })

    const isRegistered =
      (data.Status === 0 && data.Answer?.length > 0) ||
      (data.Status === 3 && data.Authority?.some(auth => auth.type !== 6))

    const available = !isRegistered

    const tld = '.' + domain.split('.').pop()
    const { namecheapTLDs } = await import(`~/utils/tlds`)
    
    const link = available
      ? namecheapTLDs.includes(tld)
        ? `https://www.namecheap.com/domains/registration/results/?domain=${domain}`
        : `https://domainr.com/${domain}`
      : `http://${domain}`

    return { domain, available, link }
  } catch (error) {
    console.error(`Error checking ${domain}:`, error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Error checking domain',
    })
  }
})
