import { namecheapTLDs } from '~/utils/tlds'
import { DomainAvailabilityStatus } from './types'

/**
 * Generates a registration, information, or visit link for a domain
 * based on its availability status.
 */
export const generateLink = (domain: string, status: DomainAvailabilityStatus): string => {
    const tld = '.' + domain.split('.').pop()

    let registrarBaseUrl = `https://domainr.com/`

    if (tld && namecheapTLDs.includes(tld)) {
      registrarBaseUrl = `https://www.namecheap.com/domains/registration/results/?domain=`
    }

    switch (status) {
      case DomainAvailabilityStatus.REGISTERED:
        return domain.startsWith('http') ? domain : `http://${domain}`
      case DomainAvailabilityStatus.PREMIUM:
        if (tld && namecheapTLDs.includes(tld)) {
            return `${registrarBaseUrl}${domain}`
        }
        return `https://dan.com/buy-domain/${domain}`
      case DomainAvailabilityStatus.AVAILABLE:
        return `${registrarBaseUrl}${domain}`
      case DomainAvailabilityStatus.INDETERMINATE:
      case DomainAvailabilityStatus.ERROR:
      default:
        return `https://domainr.com/${domain}`
    }
} 