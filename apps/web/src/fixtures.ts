import { Asset } from '@quartermaster/contracts';

export const demoTenantId = '11111111-1111-4111-8111-111111111111';
export const demoAssets = [
  {
    id: '11111111-1111-4111-8111-111111111112',
    name: 'Main building rooftop AC',
    assetClass: 'air_conditioner',
    status: 'needs_attention',
    location: 'Main building / Roof / Northwest',
    manufacturer: 'Example HVAC',
    model: 'Rooftop 5',
    serialNumber: 'DEMO-001',
    notes:
      'Tubing insulation is weathered. Outdoor coil cover screws are rounded out; record this access constraint before future maintenance.',
  },
  {
    id: '11111111-1111-4111-8111-111111111113',
    name: 'Fellowship hall refrigerator',
    assetClass: 'appliance',
    status: 'in_service',
    location: 'Fellowship hall / Kitchen',
    manufacturer: 'Example Appliances',
    model: 'Commercial 40',
    serialNumber: 'DEMO-002',
    notes:
      'Synthetic example. Door seals inspected during the last walkthrough.',
  },
  {
    id: '11111111-1111-4111-8111-111111111114',
    name: 'Office air conditioner',
    assetClass: 'air_conditioner',
    status: 'in_service',
    location: 'Main building / Office wing',
    manufacturer: null,
    model: null,
    serialNumber: null,
    notes:
      'Nameplate details have not yet been recorded. Missing information remains unknown.',
  },
  {
    id: '11111111-1111-4111-8111-111111111115',
    name: 'Kitchen dishwasher',
    assetClass: 'appliance',
    status: 'out_of_service',
    location: 'Fellowship hall / Kitchen',
    manufacturer: 'Example Appliances',
    model: 'Wash 20',
    serialNumber: 'DEMO-004',
    notes: 'Synthetic example awaiting a human maintenance assessment.',
  },
].map((value) =>
  Asset.parse({
    ...value,
    tenantId: demoTenantId,
    version: 1,
    updatedAt: '2026-09-07T12:00:00.000Z',
  }),
);
