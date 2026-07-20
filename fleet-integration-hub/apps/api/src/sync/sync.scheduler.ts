import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SyncService } from './sync.service';

/**
 * Planificador: sincroniza todas las conexiones activas cada 15 minutos.
 * Escalado horizontal: mover este job a una cola (BullMQ/pg-boss) con un
 * job por conexión y bloqueo distribuido; el servicio ya es idempotente.
 */
@Injectable()
export class SyncScheduler {
  private readonly logger = new Logger(SyncScheduler.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: SyncService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async run(): Promise<void> {
    if (this.running) return; // evita solapes si una pasada tarda más que el intervalo
    this.running = true;
    try {
      const connections = await this.prisma.providerConnection.findMany({
        where: { status: { in: ['active', 'pending'] } },
        select: { id: true, provider: true },
      });
      this.logger.log(`Sincronizando ${connections.length} conexiones`);
      for (const conn of connections) {
        await this.sync.syncConnection(conn.id).catch((err) => {
          this.logger.error(`Conexión ${conn.id} (${conn.provider}): ${err.message}`);
        });
      }
    } finally {
      this.running = false;
    }
  }
}
