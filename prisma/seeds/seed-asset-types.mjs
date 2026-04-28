#!/usr/bin/env node
// Seeds the canonical AssetType catalogue for every tenant. Idempotent
// upsert by (tenantId, key). Based on the operational taxonomy from the
// SSOT / P-ASSET spec (HVAC, Electrical, Fire, Lift, Water, Comms, etc.)

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL_MIGRATOR || process.env.DATABASE_URL } },
});

const TYPES = [
  // HVAC
  {
    key: 'hvac.ahu',
    name: 'Air Handling Unit (AHU)',
    systemFamily: 'HVAC',
    isSerialized: true,
    description: 'Modular / sectional AHU / FAHU',
  },
  { key: 'hvac.fcu', name: 'Fan Coil Unit (FCU)', systemFamily: 'HVAC', isSerialized: true },
  { key: 'hvac.vav', name: 'VAV terminal', systemFamily: 'HVAC', isSerialized: true },
  { key: 'hvac.chiller', name: 'Chiller', systemFamily: 'HVAC', isSerialized: true },
  { key: 'hvac.boiler', name: 'Boiler', systemFamily: 'HVAC', isSerialized: true },
  { key: 'hvac.heat_pump', name: 'Heat pump', systemFamily: 'HVAC', isSerialized: true },
  { key: 'hvac.rooftop', name: 'Rooftop unit', systemFamily: 'HVAC', isSerialized: true },
  {
    key: 'hvac.vrf_outdoor',
    name: 'VRF/VRV outdoor unit',
    systemFamily: 'HVAC',
    isSerialized: true,
  },
  { key: 'hvac.vrf_indoor', name: 'VRF/VRV indoor unit', systemFamily: 'HVAC', isSerialized: true },
  { key: 'hvac.fan', name: 'Vent fan (supply/exhaust)', systemFamily: 'HVAC', isSerialized: true },
  { key: 'hvac.heat_exchanger', name: 'Heat exchanger', systemFamily: 'HVAC', isSerialized: true },
  { key: 'hvac.pump', name: 'Circulating pump', systemFamily: 'HVAC', isSerialized: true },
  {
    key: 'hvac.valve.picv',
    name: 'PICV / balancing valve',
    systemFamily: 'HVAC',
    isSerialized: true,
  },
  { key: 'hvac.damper', name: 'Damper / actuator', systemFamily: 'HVAC', isSerialized: true },
  { key: 'hvac.filter', name: 'Filter (air)', systemFamily: 'HVAC', isSerialized: false },
  { key: 'hvac.humidifier', name: 'Humidifier', systemFamily: 'HVAC', isSerialized: true },

  // Electrical
  {
    key: 'electrical.transformer',
    name: 'Transformer',
    systemFamily: 'Electrical',
    isSerialized: true,
  },
  {
    key: 'electrical.msb',
    name: 'Main switchboard (GRSh / MSB)',
    systemFamily: 'Electrical',
    isSerialized: true,
  },
  {
    key: 'electrical.switchboard',
    name: 'Distribution switchboard',
    systemFamily: 'Electrical',
    isSerialized: true,
  },
  { key: 'electrical.ats', name: 'ATS / АВР', systemFamily: 'Electrical', isSerialized: true },
  { key: 'electrical.ups', name: 'UPS / ИБП', systemFamily: 'Electrical', isSerialized: true },
  {
    key: 'electrical.genset',
    name: 'Diesel generator set (DGU)',
    systemFamily: 'Electrical',
    isSerialized: true,
  },
  {
    key: 'electrical.breaker',
    name: 'MCB / MCCB / RCCB / AFDD',
    systemFamily: 'Electrical',
    isSerialized: true,
  },
  {
    key: 'electrical.busway',
    name: 'Busway / busbar trunking',
    systemFamily: 'Electrical',
    isSerialized: false,
  },
  {
    key: 'electrical.meter',
    name: 'Electricity meter',
    systemFamily: 'Electrical',
    isSerialized: true,
  },
  { key: 'electrical.pdu', name: 'PDU', systemFamily: 'Electrical', isSerialized: true },
  {
    key: 'electrical.cable_tray',
    name: 'Cable tray / raceway',
    systemFamily: 'Electrical',
    isSerialized: false,
  },

  // Water
  {
    key: 'water.booster_pump',
    name: 'Pressure booster pump station',
    systemFamily: 'Water',
    isSerialized: true,
  },
  {
    key: 'water.hot_water_pump',
    name: 'DHW recirculation pump',
    systemFamily: 'Water',
    isSerialized: true,
  },
  {
    key: 'water.water_heater',
    name: 'Water heater / boiler DHW',
    systemFamily: 'Water',
    isSerialized: true,
  },
  { key: 'water.storage_tank', name: 'Storage tank', systemFamily: 'Water', isSerialized: true },
  {
    key: 'water.softener',
    name: 'Water softener / treatment',
    systemFamily: 'Water',
    isSerialized: true,
  },
  { key: 'water.prv', name: 'Pressure reducing valve', systemFamily: 'Water', isSerialized: true },
  { key: 'water.leak_sensor', name: 'Leak sensor', systemFamily: 'Water', isSerialized: true },

  // Drainage
  {
    key: 'drainage.sewage_pump',
    name: 'Sewage lifting pump',
    systemFamily: 'Drainage',
    isSerialized: true,
  },
  {
    key: 'drainage.grease_separator',
    name: 'Grease separator',
    systemFamily: 'Drainage',
    isSerialized: true,
  },
  {
    key: 'drainage.oil_separator',
    name: 'Oil/light-liquid separator',
    systemFamily: 'Drainage',
    isSerialized: true,
  },
  { key: 'drainage.sump_pump', name: 'Sump pump', systemFamily: 'Drainage', isSerialized: true },
  {
    key: 'drainage.floor_drain',
    name: 'Floor drain / trap',
    systemFamily: 'Drainage',
    isSerialized: false,
  },
  {
    key: 'drainage.stormwater',
    name: 'Stormwater pit / catch basin',
    systemFamily: 'Drainage',
    isSerialized: false,
  },

  // Fire detection
  {
    key: 'fire.panel',
    name: 'Fire alarm control panel (FACP)',
    systemFamily: 'Fire',
    isSerialized: true,
  },
  {
    key: 'fire.loop_controller',
    name: 'Fire loop addressable controller',
    systemFamily: 'Fire',
    isSerialized: true,
  },
  { key: 'fire.smoke_detector', name: 'Smoke detector', systemFamily: 'Fire', isSerialized: true },
  { key: 'fire.heat_detector', name: 'Heat detector', systemFamily: 'Fire', isSerialized: true },
  {
    key: 'fire.manual_callpoint',
    name: 'Manual callpoint',
    systemFamily: 'Fire',
    isSerialized: true,
  },
  { key: 'fire.io_module', name: 'Fire I/O module', systemFamily: 'Fire', isSerialized: true },
  {
    key: 'fire.sounder',
    name: 'Sounder / speaker / strobe',
    systemFamily: 'Fire',
    isSerialized: true,
  },

  // Fire suppression
  {
    key: 'suppression.sprinkler_pump',
    name: 'Sprinkler pump',
    systemFamily: 'FireSuppression',
    isSerialized: true,
  },
  {
    key: 'suppression.jockey_pump',
    name: 'Jockey pump',
    systemFamily: 'FireSuppression',
    isSerialized: true,
  },
  {
    key: 'suppression.valve_station',
    name: 'Wet/dry valve station',
    systemFamily: 'FireSuppression',
    isSerialized: true,
  },
  {
    key: 'suppression.sprinkler_head',
    name: 'Sprinkler head',
    systemFamily: 'FireSuppression',
    isSerialized: false,
  },
  {
    key: 'suppression.gas_system',
    name: 'Gas suppression system',
    systemFamily: 'FireSuppression',
    isSerialized: true,
  },
  {
    key: 'suppression.hose_cabinet',
    name: 'Fire hose cabinet',
    systemFamily: 'FireSuppression',
    isSerialized: true,
  },
  {
    key: 'suppression.extinguisher',
    name: 'Portable fire extinguisher',
    systemFamily: 'FireSuppression',
    isSerialized: true,
  },

  // Lift
  { key: 'lift.passenger', name: 'Passenger lift', systemFamily: 'Lift', isSerialized: true },
  { key: 'lift.freight', name: 'Freight lift', systemFamily: 'Lift', isSerialized: true },
  { key: 'lift.hospital', name: 'Hospital lift', systemFamily: 'Lift', isSerialized: true },
  {
    key: 'lift.pwd_platform',
    name: 'PWD / accessibility platform',
    systemFamily: 'Lift',
    isSerialized: true,
  },
  { key: 'lift.escalator', name: 'Escalator', systemFamily: 'Lift', isSerialized: true },
  {
    key: 'lift.travelator',
    name: 'Autowalk / travelator',
    systemFamily: 'Lift',
    isSerialized: true,
  },

  // BMS / monitoring
  { key: 'bms.server', name: 'BMS enterprise server', systemFamily: 'BMS', isSerialized: true },
  { key: 'bms.plc', name: 'PLC / RTU', systemFamily: 'BMS', isSerialized: true },
  { key: 'bms.io_module', name: 'BMS I/O module', systemFamily: 'BMS', isSerialized: true },
  {
    key: 'bms.gateway',
    name: 'Protocol gateway (BACnet/Modbus/KNX)',
    systemFamily: 'BMS',
    isSerialized: true,
  },
  { key: 'bms.hmi', name: 'HMI display', systemFamily: 'BMS', isSerialized: true },
  {
    key: 'monitoring.crackmeter',
    name: 'Crackmeter',
    systemFamily: 'StructuralMonitoring',
    isSerialized: true,
  },
  {
    key: 'monitoring.tilt',
    name: 'Tiltmeter / inclinometer',
    systemFamily: 'StructuralMonitoring',
    isSerialized: true,
  },
  {
    key: 'monitoring.vibration',
    name: 'Vibration sensor',
    systemFamily: 'StructuralMonitoring',
    isSerialized: true,
  },
  {
    key: 'monitoring.datalogger',
    name: 'Datalogger',
    systemFamily: 'StructuralMonitoring',
    isSerialized: true,
  },

  // Renewable / low-carbon
  {
    key: 'renewable.pv_array',
    name: 'PV panel array (group)',
    systemFamily: 'RenewableEnergy',
    isSerialized: false,
  },
  {
    key: 'renewable.inverter',
    name: 'Inverter (string/central)',
    systemFamily: 'RenewableEnergy',
    isSerialized: true,
  },
  {
    key: 'renewable.battery',
    name: 'Battery / ESS',
    systemFamily: 'RenewableEnergy',
    isSerialized: true,
  },
  {
    key: 'renewable.solar_thermal',
    name: 'Solar thermal collector',
    systemFamily: 'RenewableEnergy',
    isSerialized: true,
  },

  // Comms / IT
  {
    key: 'comms.mdf',
    name: 'MDF / main distribution frame',
    systemFamily: 'Comms',
    isSerialized: true,
  },
  { key: 'comms.idf', name: 'IDF / floor distribution', systemFamily: 'Comms', isSerialized: true },
  { key: 'comms.switch', name: 'Network switch', systemFamily: 'Comms', isSerialized: true },
  { key: 'comms.wifi_ap', name: 'Wi-Fi access point', systemFamily: 'Comms', isSerialized: true },
  {
    key: 'comms.odf',
    name: 'Optical distribution frame (ODF)',
    systemFamily: 'Comms',
    isSerialized: true,
  },
  { key: 'comms.ip_pbx', name: 'IP PBX / telephony', systemFamily: 'Comms', isSerialized: true },

  // Security / CCTV
  { key: 'security.camera', name: 'IP camera', systemFamily: 'Security', isSerialized: true },
  { key: 'security.nvr', name: 'NVR / VMS', systemFamily: 'Security', isSerialized: true },
  { key: 'security.motion', name: 'Motion detector', systemFamily: 'Security', isSerialized: true },
  {
    key: 'security.contact',
    name: 'Door / window contact',
    systemFamily: 'Security',
    isSerialized: true,
  },
  {
    key: 'security.intercom',
    name: 'Intercom / entry-phone',
    systemFamily: 'Security',
    isSerialized: true,
  },

  // Access control
  {
    key: 'access.controller',
    name: 'Access controller',
    systemFamily: 'AccessControl',
    isSerialized: true,
  },
  {
    key: 'access.reader',
    name: 'Card/credential reader',
    systemFamily: 'AccessControl',
    isSerialized: true,
  },
  {
    key: 'access.maglock',
    name: 'Magnetic / electric lock',
    systemFamily: 'AccessControl',
    isSerialized: true,
  },
  { key: 'access.turnstile', name: 'Turnstile', systemFamily: 'AccessControl', isSerialized: true },
  {
    key: 'access.barrier',
    name: 'Vehicle barrier / gate',
    systemFamily: 'AccessControl',
    isSerialized: true,
  },

  // Lighting
  {
    key: 'lighting.luminaire',
    name: 'Luminaire (general)',
    systemFamily: 'Lighting',
    isSerialized: false,
  },
  {
    key: 'lighting.emergency',
    name: 'Emergency / evacuation light',
    systemFamily: 'Lighting',
    isSerialized: true,
  },
  { key: 'lighting.exit_sign', name: 'Exit sign', systemFamily: 'Lighting', isSerialized: true },
  {
    key: 'lighting.controller',
    name: 'Lighting controller / DALI',
    systemFamily: 'Lighting',
    isSerialized: true,
  },

  // Envelope / Architecture
  { key: 'roof.zone', name: 'Roof waterproofing zone', systemFamily: 'Roof', isSerialized: false },
  { key: 'roof.drain', name: 'Roof drain / gully', systemFamily: 'Roof', isSerialized: true },
  { key: 'roof.hatch', name: 'Roof hatch / access', systemFamily: 'Roof', isSerialized: true },
  {
    key: 'envelope.facade_zone',
    name: 'Facade zone (ventilated / ETICS)',
    systemFamily: 'Envelope',
    isSerialized: false,
  },
  {
    key: 'glazing.curtain_wall',
    name: 'Curtain wall section',
    systemFamily: 'Glazing',
    isSerialized: false,
  },
  { key: 'glazing.window', name: 'Window unit', systemFamily: 'Glazing', isSerialized: true },
  { key: 'glazing.door', name: 'External door', systemFamily: 'Glazing', isSerialized: true },
  {
    key: 'finishes.ceiling_zone',
    name: 'Suspended ceiling zone',
    systemFamily: 'Finishes',
    isSerialized: false,
  },
  { key: 'flooring.zone', name: 'Flooring zone', systemFamily: 'Flooring', isSerialized: false },
  {
    key: 'flooring.raised',
    name: 'Raised floor section',
    systemFamily: 'Flooring',
    isSerialized: false,
  },
  {
    key: 'waterproofing.basement',
    name: 'Basement waterproofing / sump',
    systemFamily: 'Waterproofing',
    isSerialized: false,
  },

  // Sanitary
  { key: 'sanitary.wc', name: 'WC / toilet', systemFamily: 'Sanitary', isSerialized: true },
  { key: 'sanitary.urinal', name: 'Urinal', systemFamily: 'Sanitary', isSerialized: true },
  { key: 'sanitary.basin', name: 'Wash basin', systemFamily: 'Sanitary', isSerialized: true },
  { key: 'sanitary.shower', name: 'Shower', systemFamily: 'Sanitary', isSerialized: true },
  {
    key: 'sanitary.dispenser',
    name: 'Soap / towel / hand dryer dispenser',
    systemFamily: 'Sanitary',
    isSerialized: false,
  },
  {
    key: 'sanitary.accessible_rail',
    name: 'Accessibility grab rail',
    systemFamily: 'Sanitary',
    isSerialized: false,
  },

  // Service / Workshop / Waste / Storage
  {
    key: 'service.scrubber',
    name: 'Scrubber-dryer / cleaning machine',
    systemFamily: 'Service',
    isSerialized: true,
  },
  {
    key: 'service.vacuum',
    name: 'Professional vacuum',
    systemFamily: 'Service',
    isSerialized: true,
  },
  {
    key: 'service.cart',
    name: 'Housekeeping / utility cart',
    systemFamily: 'Service',
    isSerialized: false,
  },
  { key: 'waste.compactor', name: 'Waste compactor', systemFamily: 'Waste', isSerialized: true },
  { key: 'waste.baler', name: 'Cardboard baler', systemFamily: 'Waste', isSerialized: true },
  { key: 'waste.bin', name: 'Waste / recycling bin', systemFamily: 'Waste', isSerialized: false },
  {
    key: 'storage.shelving',
    name: 'Shelving / rack unit',
    systemFamily: 'Storage',
    isSerialized: false,
  },
  {
    key: 'workshop.compressor',
    name: 'Air compressor',
    systemFamily: 'Workshop',
    isSerialized: true,
  },
  { key: 'workshop.bench', name: 'Workbench', systemFamily: 'Workshop', isSerialized: false },

  // Other / custom bucket (extensible)
  {
    key: 'other.custom',
    name: 'Custom / tenant-specific',
    systemFamily: 'Other',
    isSerialized: true,
  },
];

async function run() {
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  if (tenants.length === 0) {
    console.error('[asset-types] no tenants yet');
    process.exit(1);
  }
  let seeded = 0;
  for (const t of tenants) {
    for (const type of TYPES) {
      await prisma.assetType.upsert({
        where: { tenantId_key: { tenantId: t.id, key: type.key } },
        create: { tenantId: t.id, ...type, isBuiltIn: true, isActive: true },
        update: {
          name: type.name,
          systemFamily: type.systemFamily,
          isSerialized: type.isSerialized,
          description: type.description ?? null,
          isBuiltIn: true,
          isActive: true,
        },
      });
      seeded++;
    }
  }
  console.log(
    JSON.stringify(
      { ok: true, tenants: tenants.length, assetTypes: TYPES.length, total: seeded },
      null,
      2,
    ),
  );
}

run()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
