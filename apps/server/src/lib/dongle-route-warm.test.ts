import { describe, expect, it } from 'vitest';

import { guessDongleGateway } from './dongle-route-warm.js';

describe('guessDongleGateway', () => {
  it('uses .1 for ZTE RNDIS subnet', () => {
    expect(guessDongleGateway('192.168.3.100')).toBe('192.168.3.1');
  });

  it('uses Samsung tether gateway', () => {
    expect(guessDongleGateway('192.168.42.55')).toBe('192.168.42.129');
  });
});
