import 'server-only';
import { BlockList, isIP } from 'node:net';
import { headers } from 'next/headers';

/**
 * The client's IP address (MAX needs it as register_ip, src/lib/accountOpening.js). Read from the proxy headers of the
 * current request: the first address of X-Forwarded-For (the client; the rest are proxies), else X-Real-IP.
 */
export async function requestIp() {
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || (h.get('x-real-ip') ?? '').trim();
  const bare = ip.replace(/^\[|\](:\d+)?$/g, '').replace(/^::ffff:(?=\d+\.)/, ''); // [v6]:port, v4-mapped v6
  return isIP(bare) ? bare : null;
}

// loopback, private, link-local and shared ranges: not a client's real address (e.g. local development)
const internal = new BlockList();
for (const [net, bits] of [['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['127.0.0.0', 8], ['169.254.0.0', 16], ['100.64.0.0', 10], ['0.0.0.0', 8]])
  internal.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [['::1', 128], ['fc00::', 7], ['fe80::', 10], ['::', 128]]) internal.addSubnet(net, bits, 'ipv6');

/** `ip` when it is a public address, else null. */
export const publicIp = (ip) => {
  const type = isIP(String(ip ?? ''));
  return type && !internal.check(ip, type === 6 ? 'ipv6' : 'ipv4') ? ip : null;
};
