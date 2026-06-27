import { describe, expect, it } from 'vitest';

import {
  guessDongleGateway,
  isPostingDongleProxyPort,
  postingSlotFromProxyPort,
} from './dongle-route-warm.js';

describe('guessDongleGateway', () => {
  it('uses .1 for ZTE RNDIS subnet', () => {
    expect(guessDongleGateway('192.168.3.100')).toBe('192.168.3.1');
  });

  it('uses Samsung tether gateway', () => {
    expect(guessDongleGateway('192.168.42.55')).toBe('192.168.42.129');
  });
});

describe('isPostingDongleProxyPort', () => {
  it('matches posting ports only', () => {
    expect(isPostingDongleProxyPort(10001)).toBe(true);
    expect(isPostingDongleProxyPort(10005)).toBe(true);
    expect(isPostingDongleProxyPort(10006)).toBe(false);
  });

  it('maps proxy port to slot', () => {
    expect(postingSlotFromProxyPort(10003)).toBe(3);
    expect(postingSlotFromProxyPort(10007)).toBeNull();
  });
});
