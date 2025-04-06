import type { DnsResponse } from '~/utils/DohResolver'
import { DNS_RECORD_TYPE_TXT } from '../constants'
import type { TxtAnalysisResult } from '../types'

// --- Parking Detection Data ---
// Source: https://raw.githubusercontent.com/MISP/misp-warninglists/main/lists/parking-domain-ns/list.json
export const PARKING_NAMESERVERS = new Set([
  'above.com',
  'afternic.com',
  'alter.com',
  'bodis.com',
  'bookmyname.com',
  'brainydns.com',
  'brandbucket.com',
  'chookdns.com',
  'cnomy.com',
  'commonmx.com',
  'dan.com',
  'day.biz',
  'dingodns.com',
  'directnic.com',
  'dne.com',
  'dnslink.com',
  'dnsnuts.com',
  'dnsowl.com',
  'dnsspark.com',
  'domain-for-sale.at',
  'domain-for-sale.se',
  'domaincntrol.com',
  'domainhasexpired.com',
  'domainist.com',
  'domainmarket.com',
  'domainmx.com',
  'domainorderdns.nl',
  'domainparking.ru',
  'domainprofi.de',
  'domainrecover.com',
  'dsredirection.com',
  'dsredirects.com',
  'eftydns.com',
  'emailverification.info',
  'emu-dns.com',
  'expiereddnsmanager.com',
  'expirationwarning.net',
  'expired.uniregistry-dns.com',
  'fabulous.com',
  'failed-whois-verification.namecheap.com.',
  'fastpark.net',
  'freenom.com',
  'gname.net',
  'hastydns.com',
  'hostresolver.com',
  'ibspark.com',
  'kirklanddc.com',
  'koaladns.com',
  'magpiedns.com',
  'malkm.com',
  'markmonitor.com',
  'mijndomein.nl',
  'milesmx.com',
  'mytrafficmanagement.com',
  'name.com',
  'namedynamics.net',
  'nameprovider.net',
  'ndsplitter.com',
  'ns01.cashparking.com',
  'ns02.cashparking.com',
  'ns1.domain-is-4-sale-at-domainmarket.com',
  'ns1.domain.io',
  'ns1.namefind.com',
  'ns1.park.do',
  'ns1.parkingcrew.net',
  'ns1.pql.net',
  'ns1.sedoparking.com',
  'ns1.smartname.com',
  'ns1.sonexo.eu',
  'ns1.undeveloped.com',
  'ns2.domain.io',
  'ns2.domainmarket.com',
  'ns2.namefind.com',
  'ns2.park.do',
  'ns2.parkingcrew.net',
  'ns2.pql.net',
  'ns2.sedoparking.com',
  'ns2.smartname.com',
  'ns2.sonexo.com',
  'ns2.undeveloped.com',
  'ns3.tppns.com',
  'ns4.tppns.com',
  'nsresolution.com',
  'one.com',
  'onlydomains.com',
  'panamans.com',
  'park1.encirca.net',
  'park2.encirca.net',
  'parkdns1.internetvikings.com',
  'parkdns2.internetvikings.com',
  'parking-page.net',
  'parking.namecheap.com',
  'parking1.ovh.net',
  'parking2.ovh.net',
  'parkingcrew.net',
  'parkingpage.namecheap.com',
  'parkingspa.com',
  'parklogic.com',
  'parktons.com',
  'perfectdomain.com',
  'quokkadns.com',
  'redirectdom.com',
  'redmonddc.com',
  'registrar-servers.com',
  'renewyourname.net',
  'rentondc.com',
  'rookdns.com',
  'rzone.de',
  'sav.com',
  'searchfusion.com',
  'searchreinvented.com',
  'securetrafficrouting.com',
  'sedo.com',
  'sedoparking.com',
  'smtmdns.com',
  'snparking.ru',
  'squadhelp.com',
  'sslparking.com',
  'tacomadc.com',
  'taipandns.com',
  'thednscloud.com',
  'torresdns.com',
  'trafficcontrolrouter.com',
  'trustednam.es',
  'uniregistrymarket.link',
  'verify-contact-details.namecheap.com.',
  'voodoo.com',
  'weaponizedcow.com',
  'wombatdns.com',
  'wordpress.com',
  'www.undeveloped.com----type.in',
  'your-browser.this-domain.eu',
  'ztomy.com',
  'dns1.registrar-servers.com',
  'dns2.registrar-servers.com'
].map(ns => ns.toLowerCase())); // Store in lowercase for case-insensitive comparison

// Comprehensive pattern definitions based on research (Memoized at module level)
export const PARKING_PATTERNS = {
    // Restrictive SPF policies
    SPF: [
        /^v=spf1\s+-all$/i,                   // Explicit block all
        /^v=spf1\s+(?!.*[?~+]).*-all$/i       // Any non-permissive SPF ending with -all
    ],
    // Empty/null DKIM configurations
    DKIM: [
        /v=DKIM1;\s*p=\s*$/i,                 // Empty p parameter
        /v=DKIM1;\s*p=["']?\s*["']?$/i,       // Empty quoted p parameter
        /v=DKIM1;\s*k=rsa;\s*p=$/i            // RSA key with empty p
    ],
    // Restrictive DMARC policies
    DMARC: [
        /v=DMARC1;\s*p=reject/i,              // Reject policy
        /v=DMARC1;\s*p=quarantine/i,          // Quarantine policy
        /v=DMARC1;\s*p=reject;\s*adkim=s/i    // Strict alignment
    ],
    // Explicit registrar parking indicators
    REGISTRAR: [
        /parking_verification/i,               // Standard parking verification
        /domain_control_validation/i,          // Domain control validation
        /sedoparking/i,                        // Sedo parking
        /parkingcrew/i,                        // ParkingCrew
        /domain[-_]?parking/i                  // Generic domain parking
    ],
    // Premium domain markers
    PREMIUM: [
        /premium[-_]?domain/i,                 // Premium domain indicator
        /domain[-_]?for[-_]?sale/i,            // For sale marker
        /inquire.*purchase/i,                  // Purchase inquiry
        /domainbroker/i,                       // Domain broker reference
        /reserve[d]?[-_]?domain/i              // Reserved domain
    ],
    // Active domain usage signals
    ACTIVE_USAGE: [
        /google-site-verification=/i,          // Google site verification
        /ms=ms\d+/i,                           // Microsoft verification
        /facebook-domain-verification=/i,      // Facebook domain verification
        /apple-domain-verification=/i,         // Apple domain verification
        /docusign=.+/i,                        // DocuSign verification
        /stripe-verification=/i                // Stripe verification
    ]
};

/**
 * Analyzes TXT records for parking patterns, premium domain indicators,
 * and active usage signals.
 */
export const analyzeTxtRecordsForParking = (data: DnsResponse): TxtAnalysisResult => {
    if (!data.Answer || data.Answer.length === 0) {
        return { 
            isParked: false, 
            isPremium: false, 
            confidence: 0, 
            matchedPatterns: [], 
            hasActiveUsageIndicators: false 
        };
    }

    const patternsFound = new Set<string>();
    let hasSpf = false, hasDkim = false, hasDmarc = false,
        hasWildcard = false, hasRegistrarMarker = false, hasPremiumMarker = false,
        hasVerificationTxt = false;

    data.Answer.forEach(record => {
        if (record.type === DNS_RECORD_TYPE_TXT && typeof record.data === 'string') {
            const txtData = record.data.trim().replace(/^"|"$/g, '');
            const name = record.name.toLowerCase();

            const testPattern = (patterns: RegExp[], category: string) => {
                patterns.forEach(pattern => {
                    try {
                        if (pattern.test(txtData)) {
                            let patternDescription = '';
                            switch(category) {
                                case 'SPF': hasSpf = true; patternDescription = "Restrictive SPF Policy (-all)"; break;
                                case 'DKIM': if (name.includes('_domainkey')) { hasDkim = true; patternDescription = "Null DKIM Configuration"; } break;
                                case 'DMARC': if (name.startsWith('_dmarc.') || name === '_dmarc') { hasDmarc = true; patternDescription = "Restrictive DMARC Policy"; } break;
                                case 'REGISTRAR':
                                    hasRegistrarMarker = true;
                                    if (txtData.includes('parkingcrew')) patternDescription = "ParkingCrew Parking Service";
                                    else if (txtData.includes('sedoparking')) patternDescription = "Sedo Parking Service";
                                    else if (txtData.includes('domain_control_validation')) patternDescription = "Domain Control Validation";
                                    else patternDescription = "Registrar Parking Marker";
                                    break;
                                case 'PREMIUM':
                                    hasPremiumMarker = true;
                                    if (pattern.toString().includes('premium')) patternDescription = "Premium Domain Marker";
                                    else if (pattern.toString().includes('for[-_]?sale')) patternDescription = "Domain For Sale Marker";
                                    else if (pattern.toString().includes('inquire')) patternDescription = "Domain Purchase Inquiry";
                                    else if (pattern.toString().includes('domainbroker')) patternDescription = "Domain Broker Reference";
                                    else if (pattern.toString().includes('reserve')) patternDescription = "Reserved Domain";
                                    else patternDescription = "Generic Premium Domain Marker";
                                    break;
                                case 'ACTIVE_USAGE':
                                    hasVerificationTxt = true;
                                    if (pattern.toString().includes('google-site-verification')) patternDescription = "Google Site Verification";
                                    else if (pattern.toString().includes('ms=ms')) patternDescription = "Microsoft Verification";
                                    else if (pattern.toString().includes('facebook')) patternDescription = "Facebook Domain Verification";
                                    else if (pattern.toString().includes('apple')) patternDescription = "Apple Domain Verification";
                                    else if (pattern.toString().includes('docusign')) patternDescription = "DocuSign Verification";
                                    else if (pattern.toString().includes('stripe')) patternDescription = "Stripe Verification";
                                    else patternDescription = "Service Verification TXT";
                                    break;
                            }
                            if (patternDescription) patternsFound.add(patternDescription);
                        }
                    } catch (e) {
                        console.error(`Regex error testing pattern ${pattern} on data: ${txtData}`, e);
                    }
                });
            };

            if (name.startsWith('*.') || name.includes('.*')) {
                if (!patternsFound.has("Wildcard DNS Protection")) {
                    hasWildcard = true;
                    patternsFound.add("Wildcard DNS Protection");
                }
            }

            testPattern(PARKING_PATTERNS.SPF, 'SPF');
            testPattern(PARKING_PATTERNS.DKIM, 'DKIM');
            testPattern(PARKING_PATTERNS.DMARC, 'DMARC');
            testPattern(PARKING_PATTERNS.REGISTRAR, 'REGISTRAR');
            testPattern(PARKING_PATTERNS.PREMIUM, 'PREMIUM');
            testPattern(PARKING_PATTERNS.ACTIVE_USAGE, 'ACTIVE_USAGE');
        }
    });

    let confidence = 0;
    if (hasSpf) confidence += 25;
    if (hasDkim) confidence += 20;
    if (hasDmarc) confidence += 15;
    if (hasWildcard) confidence += 15;
    if (hasRegistrarMarker) confidence += 30;
    confidence = Math.min(confidence, 100);

    const isParked = confidence >= 40;
    const isPremium = hasPremiumMarker ||
                     (isParked && confidence >= 70 &&
                      (patternsFound.has("Domain For Sale Marker") ||
                       patternsFound.has("Domain Broker Reference")));

    return {
        isParked,
        isPremium,
        confidence,
        matchedPatterns: Array.from(patternsFound),
        hasActiveUsageIndicators: hasVerificationTxt
    };
}; 