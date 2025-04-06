// DNS Status Codes
export const DNS_STATUS_NOERROR = 0
export const DNS_STATUS_FORMERR = 1
export const DNS_STATUS_SERVFAIL = 2
export const DNS_STATUS_NXDOMAIN = 3
export const DNS_STATUS_NOTIMP = 4
export const DNS_STATUS_REFUSED = 5
export const DNS_STATUS_YXDOMAIN = 6
export const DNS_STATUS_YXRRSET = 7
export const DNS_STATUS_NXRRSET = 8
export const DNS_STATUS_NOTAUTH = 9
export const DNS_STATUS_NOTZONE = 10
export const DNS_STATUS_DSOTYPENI = 11
export const DNS_STATUS_BADVERS = 16
export const DNS_STATUS_BADKEY = 17
export const DNS_STATUS_BADTIME = 18
export const DNS_STATUS_BADMODE = 19
export const DNS_STATUS_BADNAME = 20
export const DNS_STATUS_BADALG = 21
export const DNS_STATUS_BADTRUNC = 22
export const DNS_STATUS_BADCOOKIE = 23

// DNS Record Types
export const DNS_RECORD_TYPE_A = 1
export const DNS_RECORD_TYPE_NS = 2
export const DNS_RECORD_TYPE_CNAME = 5
export const DNS_RECORD_TYPE_SOA = 6
export const DNS_RECORD_TYPE_TXT = 16
export const DNS_RECORD_TYPE_AAAA = 28
export const DNS_RECORD_TYPE_RRSIG = 46
export const DNS_RECORD_TYPE_NSEC3 = 50

// Error codes that suggest a domain might exist despite a failure
export const DOMAIN_CHECK_ERRORS_SUGGESTING_DOMAIN_EXISTS = [
  DNS_STATUS_SERVFAIL,
  DNS_STATUS_REFUSED,
  DNS_STATUS_FORMERR,
  DNS_STATUS_NOTZONE
]

// DNS Status codes and their meanings
export const DNS_STATUS_MESSAGES: Record<number, string> = {
  [DNS_STATUS_NOERROR]: 'No Error',
  [DNS_STATUS_FORMERR]: 'Format Error',
  [DNS_STATUS_SERVFAIL]: 'Server Failure',
  [DNS_STATUS_NXDOMAIN]: 'Non-Existent Domain',
  [DNS_STATUS_NOTIMP]: 'Not Implemented',
  [DNS_STATUS_REFUSED]: 'Query Refused',
  [DNS_STATUS_YXDOMAIN]: 'Name Exists when it should not',
  [DNS_STATUS_YXRRSET]: 'RR Set Exists when it should not',
  [DNS_STATUS_NXRRSET]: 'RR Set that should exist does not',
  [DNS_STATUS_NOTAUTH]: 'Server Not Authoritative for zone',
  [DNS_STATUS_NOTZONE]: 'Name not contained in zone',
  [DNS_STATUS_BADVERS]: 'Bad OPT Version',
  [DNS_STATUS_BADKEY]: 'Key not recognized',
  [DNS_STATUS_BADTIME]: 'Signature out of time window',
  [DNS_STATUS_BADMODE]: 'Bad TKEY Mode',
  [DNS_STATUS_BADNAME]: 'Duplicate key name',
  [DNS_STATUS_BADALG]: 'Algorithm not supported',
  [DNS_STATUS_BADTRUNC]: 'Bad Truncation'
}; 