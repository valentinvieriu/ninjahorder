import { popularTLDs, countryTLDs, customTLDs, namecheapTLDs } from '~/utils/tlds'
import { KNOWN_WILDCARD_TLDS } from '~/config/appConfig'

const normalize = (entry: string): string => entry.toLowerCase().replace(/^\.+/, '')

const knownTldEntries = [
  ...popularTLDs,
  ...countryTLDs,
  ...customTLDs,
  ...namecheapTLDs,
  ...Array.from(KNOWN_WILDCARD_TLDS),
]

// Sort longest-first so .co.uk is matched before .uk.
const knownTldsSorted: string[] = Array.from(new Set(knownTldEntries.map(normalize)))
  .filter(entry => entry.length > 0)
  .sort((a, b) => b.length - a.length)

/**
 * Resolve the TLD (with leading dot) for a domain by longest-suffix match
 * against the union of TLD lists shipped with the app. Falls back to the last
 * label if no known suffix matches.
 *
 * Returns the suffix without the leading dot trimmed (so consumers can prefix
 * `.` consistently), and `null` when the input has no dots.
 */
export const resolveTld = (domain: string): string | null => {
  const lower = domain.toLowerCase()
  if (!lower.includes('.')) return null

  for (const candidate of knownTldsSorted) {
    if (lower.endsWith(`.${candidate}`)) return candidate
  }

  const parts = lower.split('.')
  return parts[parts.length - 1] || null
}
