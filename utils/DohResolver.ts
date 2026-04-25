/**
 * DNS over HTTPS (DoH) resolver implementation
 *
 * GET-only. RFC 8484 POST requires the binary application/dns-message wire
 * format; the previous POST branch JSON-stringified the query packet, which
 * was non-standard and silently broken against any RFC-strict server.
 * dns-json over GET is what every active DoH provider in this app supports.
 */

export const ALLOWED_REQUEST_METHODS = ['GET'] as const;

export class MethodNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MethodNotAllowedError';
  }
}

export function isMethodAllowed(method: string): boolean {
  return ALLOWED_REQUEST_METHODS.includes(method.toUpperCase() as typeof ALLOWED_REQUEST_METHODS[number]);
}

/**
 * DNS Record Types
 */
export enum DnsRecordType {
  A = 1,
  NS = 2,
  CNAME = 5,
  SOA = 6,
  MX = 15,
  TXT = 16,
  AAAA = 28,
  SRV = 33,
  DNSKEY = 48,
  DS = 43,
  RRSIG = 46,
  NSEC = 47,
  NSEC3 = 50,
  CAA = 257
}

/**
 * DNS Status Codes (RCODE values)
 */
export enum DnsStatusCode {
  NOERROR = 0,   // No error
  FORMERR = 1,   // Format error
  SERVFAIL = 2,  // Server failure
  NXDOMAIN = 3,  // Name Error
  NOTIMP = 4,    // Not implemented
  REFUSED = 5    // Query refused
}

/**
 * DNS Response structure
 */
export interface DnsResponse {
  Status: number;
  TC: boolean;
  RD: boolean;
  RA: boolean;
  AD: boolean;
  CD: boolean;
  Question: {
    name: string;
    type: number;
  }[];
  Answer?: {
    name: string;
    type: number;
    TTL: number;
    data: string;
  }[];
  Authority?: {
    name: string;
    type: number;
    TTL: number;
    data: string;
  }[];
  Additional?: {
    name: string;
    type: number;
    TTL: number;
    data: string;
  }[];
  Comment?: string;
}

/**
 * DNS Query structure
 */
export interface DnsQuery {
  type: string;
  id: number; 
  flags: number;
  questions: {
    type: string | number;
    name: string;
  }[];
}

/**
 * Make a DNS query message
 * @param qname the domain name to put in the query message (e.g. example.com)
 * @param qtype the query type to put in the query message (e.g. A, AAAA, DS, DNSKEY)
 * @returns The DNS query message
 */
export function makeQuery(qname: string, qtype: string | number): DnsQuery {
  // Determine numerical type if string provided
  let numericType: number;
  if (typeof qtype === 'string') {
    const qtypeKey = qtype.toUpperCase() as keyof typeof DnsRecordType;
    numericType = DnsRecordType[qtypeKey];
    if (!numericType) {
      throw new Error(`Unknown DNS record type: ${qtype}`);
    }
  } else {
    numericType = qtype;
  }

  return {
    type: 'query',
    id: 0, // Per RFC 8484 section 4.1, ID must be set to 0
    flags: 256, // Recursion desired (RD) flag set
    questions: [{ type: qtype, name: qname }]
  };
}

/**
 * Send a DNS message over HTTPS using dns-json over GET.
 */
export async function sendDohMsg(
  packet: DnsQuery,
  url: string,
  method: string = 'GET',
  headers: Record<string, string> = {},
  timeout: number = 5000,
  externalSignal?: AbortSignal
): Promise<DnsResponse> {
  method = method.toUpperCase();
  if (!isMethodAllowed(method)) {
    throw new MethodNotAllowedError(`Method ${method} is not allowed. Only GET is supported.`);
  }

  if (externalSignal?.aborted) {
    throw new Error('Operation was cancelled');
  }

  if (!packet.questions || packet.questions.length === 0) {
    throw new Error('Invalid DNS packet format: at least one question is required');
  }

  const mergedHeaders = { Accept: 'application/dns-json', ...headers };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', () => controller.abort());
    }
  }

  try {
    const question = packet.questions[0];
    const params = new URLSearchParams({
      name: question.name,
      type: question.type.toString(),
    });
    const fetchUrl = `${url}?${params.toString()}`;

    const response = await fetch(fetchUrl, {
      method,
      headers: mergedHeaders,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/dns-json') || contentType?.includes('application/json')) {
      return await response.json() as DnsResponse;
    }
    throw new Error(`Unexpected content type: ${contentType}`);
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`DoH request to ${url} timed out after ${timeout}ms`);
    }

    throw error;
  }
}

/**
 * A DNS over HTTPS stub resolver
 */
export class DohResolver {
  private nameserver_url: string;

  /**
   * Creates a new DoH resolver
   * @param nameserver_url The URL we're going to be sending DNS requests to
   */
  constructor(nameserver_url: string) {
    this.nameserver_url = nameserver_url;
  }

  /**
   * Perform a DNS lookup for the given query name and type.
   * Only GET (dns-json) is supported.
   */
  async query(
    qname: string,
    qtype: string | number = 'A',
    method: string = 'GET',
    headers: Record<string, string> = { 'Accept': 'application/dns-json' },
    timeout: number = 5000,
    signal?: AbortSignal
  ): Promise<DnsResponse> {
    // Create the DNS query packet
    const packet = makeQuery(qname, qtype);

    // Send the DNS message and return the response
    return sendDohMsg(packet, this.nameserver_url, method, headers, timeout, signal);
  }
} 