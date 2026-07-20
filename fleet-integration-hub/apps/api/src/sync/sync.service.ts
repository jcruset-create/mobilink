import { Injectable, Logger } from '@nestjs/common';
import { Page, ProviderError, SyncWindow } from '@fih/domain';
import { getAdapter } from '@fih/adapters';
import { PrismaService } from '../prisma/prisma.service';
import { TokenManagerService } from '../connections/token-manager.service';

type Resource = 'vehicles' | 'odometer' | 'engineHours' | 'drivers';

interface SyncStateMap {
  [resource: string]: { since: string | null; cursor: string | null };
}

/**
 * Motor de sincronización incremental.
 * Por conexión y recurso: mantiene (since, cursor) en ProviderConnection.syncState,
 * pagina hasta agotar, aplica upserts idempotentes y registra un SyncRun de auditoría.
 * Reintentos: backoff exponencial para errores transitorios, respeta retry-after
 * en rate limits, y marca la conexión en auth_error sin reintentar en fallos de auth.
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  private static readonly MAX_RETRIES = 4;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenManagerService,
  ) {}

  async syncConnection(connectionId: string): Promise<void> {
    const conn = await this.prisma.providerConnection.findUniqueOrThrow({ where: { id: connectionId } });
    if (conn.status === 'disabled') return;
    const adapter = getAdapter(conn.provider);

    const resources: Resource[] = [];
    if (adapter.capabilities.vehicles) resources.push('vehicles');
    if (adapter.capabilities.odometer) resources.push('odometer');
    if (adapter.capabilities.engineHours) resources.push('engineHours');
    if (adapter.capabilities.drivers) resources.push('drivers');

    for (const resource of resources) {
      await this.syncResource(connectionId, resource);
    }
  }

  private async syncResource(connectionId: string, resource: Resource): Promise<void> {
    const conn = await this.prisma.providerConnection.findUniqueOrThrow({ where: { id: connectionId } });
    const adapter = getAdapter(conn.provider);
    const state = (conn.syncState as SyncStateMap)[resource] ?? { since: null, cursor: null };

    const run = await this.prisma.syncRun.create({
      data: { connectionId, resource, status: 'running' },
    });

    let items = 0;
    try {
      const credentials = await this.tokens.getFreshCredentials(connectionId);
      let window: SyncWindow = { since: state.since, cursor: state.cursor };

      // Paginación hasta agotar cursor
      for (;;) {
        const page = await this.withRetries(() => this.fetchPage(adapter, resource, credentials, window));
        items += await this.persist(conn.tenantId, conn.provider, resource, page.items);
        await this.saveState(connectionId, resource, { since: state.since, cursor: page.nextCursor });
        if (!page.nextCursor) break;
        window = { since: state.since, cursor: page.nextCursor };
      }

      // Ventana incremental: la próxima sincronización parte de ahora
      await this.saveState(connectionId, resource, { since: new Date().toISOString(), cursor: null });
      await this.prisma.syncRun.update({
        where: { id: run.id },
        data: { status: 'ok', finishedAt: new Date(), itemsSynced: items },
      });
      this.logger.log(`Sync ${conn.provider}/${resource}: ${items} elementos`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.syncRun.update({
        where: { id: run.id },
        data: { status: 'error', finishedAt: new Date(), itemsSynced: items, error: message },
      });
      this.logger.error(`Sync ${conn.provider}/${resource} falló: ${message}`);
    }
  }

  private fetchPage(
    adapter: ReturnType<typeof getAdapter>,
    resource: Resource,
    credentials: Parameters<typeof adapter.listVehicles>[0],
    window: SyncWindow,
  ): Promise<Page<unknown>> {
    switch (resource) {
      case 'vehicles':
        return adapter.listVehicles(credentials, window);
      case 'odometer':
        return adapter.listOdometerReadings(credentials, window);
      case 'engineHours':
        return adapter.listEngineHours(credentials, window);
      case 'drivers':
        return adapter.listDrivers(credentials, window);
    }
  }

  private async withRetries<T>(fn: () => Promise<T>): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await fn();
      } catch (err) {
        attempt += 1;
        if (!(err instanceof ProviderError) || !err.retryable || attempt > SyncService.MAX_RETRIES) {
          throw err;
        }
        const backoff = err.kind === 'rate_limit' && err.retryAfterMs ? err.retryAfterMs : 1000 * 2 ** attempt;
        this.logger.warn(`Reintento ${attempt}/${SyncService.MAX_RETRIES} en ${backoff}ms: ${err.message}`);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }

  private async saveState(connectionId: string, resource: string, state: { since: string | null; cursor: string | null }): Promise<void> {
    const conn = await this.prisma.providerConnection.findUniqueOrThrow({ where: { id: connectionId } });
    const syncState = { ...(conn.syncState as SyncStateMap), [resource]: state };
    await this.prisma.providerConnection.update({ where: { id: connectionId }, data: { syncState } });
  }

  /** Upserts idempotentes del lote normalizado. */
  private async persist(tenantId: string, provider: string, resource: Resource, items: unknown[]): Promise<number> {
    let count = 0;
    for (const item of items) {
      const dto = item as Record<string, unknown>;
      try {
        switch (resource) {
          case 'vehicles': {
            await this.prisma.vehicle.upsert({
              where: {
                tenantId_provider_externalId: {
                  tenantId,
                  provider,
                  externalId: String(dto.externalId),
                },
              },
              create: {
                tenantId,
                provider,
                externalId: String(dto.externalId),
                plate: (dto.plate as string) ?? null,
                vin: (dto.vin as string) ?? null,
                name: (dto.name as string) ?? null,
                brand: (dto.brand as string) ?? null,
                model: (dto.model as string) ?? null,
                category: (dto.category as string) ?? 'other',
                active: (dto.active as boolean) ?? true,
                raw: (dto.raw as object) ?? undefined,
              },
              update: {
                plate: (dto.plate as string) ?? null,
                vin: (dto.vin as string) ?? null,
                name: (dto.name as string) ?? null,
                active: (dto.active as boolean) ?? true,
              },
            });
            break;
          }
          case 'odometer': {
            const vehicle = await this.prisma.vehicle.findUnique({
              where: {
                tenantId_provider_externalId: {
                  tenantId,
                  provider,
                  externalId: String(dto.externalVehicleId),
                },
              },
            });
            if (!vehicle) break;
            await this.prisma.odometerReading.upsert({
              where: { vehicleId_ts: { vehicleId: vehicle.id, ts: new Date(String(dto.timestamp)) } },
              create: {
                vehicleId: vehicle.id,
                ts: new Date(String(dto.timestamp)),
                odometerMeters: BigInt(Math.round(Number(dto.odometerMeters))),
                source: String(dto.source ?? 'unknown'),
              },
              update: {},
            });
            break;
          }
          case 'engineHours': {
            const vehicle = await this.prisma.vehicle.findUnique({
              where: {
                tenantId_provider_externalId: {
                  tenantId,
                  provider,
                  externalId: String(dto.externalVehicleId),
                },
              },
            });
            if (!vehicle) break;
            await this.prisma.engineHoursReading.upsert({
              where: { vehicleId_ts: { vehicleId: vehicle.id, ts: new Date(String(dto.timestamp)) } },
              create: {
                vehicleId: vehicle.id,
                ts: new Date(String(dto.timestamp)),
                engineHours: Number(dto.engineHours),
              },
              update: {},
            });
            break;
          }
          case 'drivers': {
            await this.prisma.driver.upsert({
              where: {
                tenantId_provider_externalId: {
                  tenantId,
                  provider,
                  externalId: String(dto.externalId),
                },
              },
              create: {
                tenantId,
                provider,
                externalId: String(dto.externalId),
                name: (dto.name as string) ?? null,
                phone: (dto.phone as string) ?? null,
                email: (dto.email as string) ?? null,
                currentVehicleExternalId: (dto.currentVehicleExternalId as string) ?? null,
              },
              update: {
                name: (dto.name as string) ?? null,
                currentVehicleExternalId: (dto.currentVehicleExternalId as string) ?? null,
              },
            });
            break;
          }
        }
        count += 1;
      } catch (err) {
        this.logger.warn(`Elemento de ${resource} descartado: ${err instanceof Error ? err.message : err}`);
      }
    }
    return count;
  }
}
