/** Tests mínimos de los adaptadores (sin red: mock de fetch global). */
import assert from 'assert';
import { getAdapter, listAdapters } from '../registry';
import { ProviderError } from '@fih/domain';

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✔ ${name}`);
  } catch (err) {
    console.error(`  ✘ ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

function mockFetch(handler: (url: string) => { status: number; body: unknown }): void {
  (globalThis as { fetch: unknown }).fetch = async (input: string | URL) => {
    const { status, body } = handler(String(input));
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
}

async function main() {
  console.log('FIH adapter tests');

  await test('El registro contiene movertis y mte', () => {
    assert.ok(listAdapters().length >= 2);
    assert.strictEqual(getAdapter('movertis').displayName, 'Movertis');
    assert.strictEqual(getAdapter('mte').key, 'mte');
  });

  await test('Proveedor desconocido lanza error', () => {
    assert.throws(() => getAdapter('nope'));
  });

  await test('Movertis normaliza vehículos al DTO común', async () => {
    mockFetch(() => ({
      status: 200,
      body: {
        data: [
          { id: 'v1', registration: '1234-ABC', type: 'camión', odometer_km: 123456.7, engine_hours: 890 },
        ],
        next: 'cursor2',
      },
    }));
    const page = await getAdapter('movertis').listVehicles(
      { kind: 'api_key', apiKey: 'test' },
      { since: null, cursor: null },
    );
    assert.strictEqual(page.items.length, 1);
    assert.strictEqual(page.items[0].plate, '1234-ABC');
    assert.strictEqual(page.items[0].category, 'truck');
    assert.strictEqual(page.nextCursor, 'cursor2');
  });

  await test('Movertis convierte odómetro km -> metros', async () => {
    mockFetch(() => ({ status: 200, body: { data: [{ id: 'v1', odometer_km: 100.5 }] } }));
    const page = await getAdapter('movertis').listOdometerReadings(
      { kind: 'api_key', apiKey: 'test' },
      { since: null, cursor: null },
    );
    assert.strictEqual(page.items[0].odometerMeters, 100500);
  });

  await test('401 se clasifica como error de autenticación', async () => {
    mockFetch(() => ({ status: 401, body: {} }));
    await assert.rejects(
      getAdapter('movertis').listVehicles({ kind: 'api_key', apiKey: 'bad' }, { since: null, cursor: null }),
      (err: unknown) => err instanceof ProviderError && err.kind === 'auth',
    );
  });

  await test('429 se clasifica como rate_limit reintentable', async () => {
    mockFetch(() => ({ status: 429, body: {} }));
    await assert.rejects(
      getAdapter('movertis').listVehicles({ kind: 'api_key', apiKey: 'x' }, { since: null, cursor: null }),
      (err: unknown) => err instanceof ProviderError && err.kind === 'rate_limit' && err.retryable,
    );
  });

  await test('MTE normaliza posiciones actuales', async () => {
    mockFetch(() => ({
      status: 200,
      body: [
        {
          imei: '356307042441013',
          vehicle_id: 'veh-001',
          device_type: 'FMC650',
          ts: '2026-07-20T10:00:00Z',
          latitude: 41.1,
          longitude: 1.25,
          speed: 80,
          heading: 90,
          ignition: true,
          movement: true,
          rpm: 1500,
          engine_hours: 1234.5,
          engine_temperature: 85,
          odometer: 250000000,
          odometer_source: 'can',
          fuel_level: 60,
          fuel_consumed: 90000,
        },
      ],
    }));
    const creds = { kind: 'api_key', apiKey: 'k', extra: { baseUrl: 'http://mte:8080' } };
    const mte = getAdapter('mte');
    const odo = await mte.listOdometerReadings(creds, { since: null, cursor: null });
    assert.strictEqual(odo.items[0].odometerMeters, 250000000);
    assert.strictEqual(odo.items[0].source, 'can');
    const status = await mte.listVehicleStatus(creds, { since: null, cursor: null });
    assert.strictEqual(status.items[0].can?.rpm, 1500);
    const hours = await mte.listEngineHours(creds, { since: null, cursor: null });
    assert.strictEqual(hours.items[0].engineHours, 1234.5);
  });

  await test('Capacidad no soportada lanza unsupported', async () => {
    await assert.rejects(
      getAdapter('movertis').listMaintenanceEvents({ kind: 'api_key' }, { since: null, cursor: null }),
      (err: unknown) => err instanceof ProviderError && err.kind === 'unsupported',
    );
  });

  console.log(`\n${passed} tests OK`);
}

main();
