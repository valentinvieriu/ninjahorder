/**
 * DNS over HTTPS (DoH) resolver implementation
 * Based on the RFC 8484 standards and best practices
 */

/**
 * Allowed request methods for sending DNS over HTTPS requests.
 * Allowed method are "GET" or "POST"
 */
export const ALLOWED_REQUEST_METHODS = ['GET', 'POST'];

/**
 * Custom error class to be thrown when someone tries to send a DoH request
 * with a request method other than "GET" or "POST"
 */
export class MethodNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MethodNotAllowedError';
  }
}

/**
 * Check if a request method is allowed
 * @param method the request method to test
 * @returns If `method` is "GET" or "POST", return true; return false otherwise.
 */
export function isMethodAllowed(method: string): boolean {
  return ALLOWED_REQUEST_METHODS.includes(method.toUpperCase());
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
 * Send a DNS message over HTTPS
 * @param packet the DNS query message to send
 * @param url the url to send the DNS message to
 * @param method the request method to use ("GET" or "POST")
 * @param headers headers to send in the DNS request
 * @param timeout the number of milliseconds to wait for a response before aborting the request
 * @returns the response (if we got any)
 */
export async function sendDohMsg(
  packet: DnsQuery,
  url: string,
  method: string = 'POST',
  headers: Record<string, string> = {},
  timeout: number = 5000
): Promise<DnsResponse> {
  // Validate the method
  method = method.toUpperCase();
  if (!isMethodAllowed(method)) {
    throw new MethodNotAllowedError(`Method ${method} is not allowed. Use GET or POST.`);
  }

  // Default headers based on method
  const defaultHeaders: Record<string, string> = {};
  if (method === 'GET') {
    defaultHeaders['Accept'] = 'application/dns-json';
  } else if (method === 'POST') {
    defaultHeaders['Accept'] = 'application/dns-message';
    defaultHeaders['Content-Type'] = 'application/dns-message';
  }

  // Merge default and custom headers
  const mergedHeaders = { ...defaultHeaders, ...headers };

  // Set up timeout with AbortController
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    // Prepare options based on method
    let fetchOptions: RequestInit = {
      method,
      headers: mergedHeaders,
      signal: controller.signal
    };

    // For GET method, we need to convert the packet to DNS wire format and encode it for URL
    // For POST method, we need to send the packet in the body
    let fetchUrl = url;
    if (method === 'GET') {
      // For GET, use dns-json format which most providers support via URL params
      if (packet.questions && packet.questions.length > 0) {
        const question = packet.questions[0];
        const params = new URLSearchParams({
          name: question.name,
          type: question.type.toString()
        });
        fetchUrl = `${url}?${params.toString()}`;
      } else {
        throw new Error('Invalid DNS packet format for GET request');
      }
    } else {
      // For POST, we'd normally use dns-packet library to encode the message
      // But for simplicity in this implementation, we'll assume the packet is already formatted correctly
      // This would need to be expanded in a full implementation
      fetchOptions.body = JSON.stringify(packet);
    }

    // Make the fetch request
    const response = await fetch(fetchUrl, fetchOptions);

    // Clear the timeout
    clearTimeout(timeoutId);

    // Check if the response is ok
    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
    }

    // Parse the response based on content type
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/dns-json') || contentType?.includes('application/json')) {
      return await response.json() as DnsResponse;
    } else if (contentType?.includes('application/dns-message')) {
      // In a full implementation, we'd use dns-packet to decode the wire format response
      // But for simplicity, we'll throw an error for now
      throw new Error('Binary DNS message format not supported in this implementation');
    } else {
      throw new Error(`Unexpected content type: ${contentType}`);
    }
  } catch (error) {
    // Clean up timeout if we have an error
    clearTimeout(timeoutId);

    // If it's an AbortError due to our timeout, throw a more descriptive error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`DoH request to ${url} timed out after ${timeout}ms`);
    }

    // Re-throw other errors
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
   * @param qname the domain name to query for (e.g. example.com)
   * @param qtype the type of record we're looking for (e.g. A, AAAA, TXT, MX)
   * @param method Must be either "GET" or "POST"
   * @param headers define HTTP headers to use in the DNS query
   * @param timeout the number of milliseconds to wait for a response before aborting the request
   * @returns The DNS response received
   * @throws {MethodNotAllowedError} If the method is not allowed (i.e. if it's not "GET" or "POST"), a MethodNotAllowedError will be thrown.
   */
  async query(
    qname: string,
    qtype: string | number = 'A',
    method: string = 'POST',
    headers: Record<string, string> = { 'Accept': 'application/dns-json' },
    timeout: number = 5000
  ): Promise<DnsResponse> {
    // Create the DNS query packet
    const packet = makeQuery(qname, qtype);

    // Send the DNS message and return the response
    return sendDohMsg(packet, this.nameserver_url, method, headers, timeout);
  }
} 