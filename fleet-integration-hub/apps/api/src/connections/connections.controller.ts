import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ProviderCredentials } from '@fih/domain';
import { getAdapter, listAdapters } from '@fih/adapters';
import { PrismaService } from '../prisma/prisma.service';
import { encryptJson } from '../common/crypto.util';
import { SyncService } from '../sync/sync.service';

interface CreateConnectionBody {
  tenantId: string;
  provider: string;
  label?: string;
  credentials: ProviderCredentials;
}

@Controller('api/v1')
export class ConnectionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: SyncService,
  ) {}

  /** Catálogo de proveedores soportados y sus capacidades. */
  @Get('providers')
  providers() {
    return listAdapters().map((a) => ({
      key: a.key,
      displayName: a.displayName,
      capabilities: a.capabilities,
    }));
  }

  /** Alta de conexión de un tenant con un proveedor (valida credenciales). */
  @Post('connections')
  async create(@Body() body: CreateConnectionBody) {
    const adapter = getAdapter(body.provider);
    const credentials = await adapter.authenticate(body.credentials);
    const conn = await this.prisma.providerConnection.create({
      data: {
        tenantId: body.tenantId,
        provider: body.provider,
        label: body.label ?? null,
        credentialsEncrypted: encryptJson(credentials),
        status: 'active',
      },
    });
    return { id: conn.id, provider: conn.provider, status: conn.status };
  }

  @Get('connections')
  async list(@Query('tenantId') tenantId: string) {
    return this.prisma.providerConnection.findMany({
      where: { tenantId },
      select: { id: true, provider: true, label: true, status: true, syncState: true, updatedAt: true },
    });
  }

  /** Lanza una sincronización manual de la conexión. */
  @Post('connections/:id/sync')
  async syncNow(@Param('id') id: string) {
    const conn = await this.prisma.providerConnection.findUnique({ where: { id } });
    if (!conn) throw new NotFoundException();
    await this.sync.syncConnection(id);
    const runs = await this.prisma.syncRun.findMany({
      where: { connectionId: id },
      orderBy: { startedAt: 'desc' },
      take: 5,
    });
    return { runs };
  }

  /** Datos canónicos consumidos por TyreControl y otros módulos Mobilink. */
  @Get('vehicles')
  async vehicles(@Query('tenantId') tenantId: string) {
    return this.prisma.vehicle.findMany({ where: { tenantId } });
  }

  @Get('vehicles/:id/odometer')
  async odometer(@Param('id') id: string) {
    const readings = await this.prisma.odometerReading.findMany({
      where: { vehicleId: id },
      orderBy: { ts: 'desc' },
      take: 100,
    });
    return readings.map((r) => ({ ...r, odometerMeters: r.odometerMeters.toString() }));
  }
}
