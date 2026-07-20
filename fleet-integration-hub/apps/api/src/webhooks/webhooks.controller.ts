import { Body, Controller, Headers, HttpCode, Logger, NotFoundException, Param, Post } from '@nestjs/common';
import { getAdapter } from '@fih/adapters';
import { PrismaService } from '../prisma/prisma.service';
import { SyncService } from '../sync/sync.service';

/**
 * Endpoint genérico de webhooks: POST /webhooks/:connectionId
 * El adaptador del proveedor verifica la firma y normaliza los eventos;
 * el hub los persiste (auditoría) y dispara una sincronización dirigida.
 */
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: SyncService,
  ) {}

  @Post(':connectionId')
  @HttpCode(202)
  async receive(
    @Param('connectionId') connectionId: string,
    @Headers() headers: Record<string, string>,
    @Body() body: unknown,
  ): Promise<{ accepted: boolean }> {
    const conn = await this.prisma.providerConnection.findUnique({ where: { id: connectionId } });
    if (!conn) throw new NotFoundException();

    const adapter = getAdapter(conn.provider);
    if (!adapter.parseWebhook) {
      this.logger.warn(`Webhook recibido para ${conn.provider}, que no los soporta`);
      return { accepted: false };
    }

    const result = await adapter.parseWebhook(headers, body, conn.webhookSecret);
    if (!result.valid) {
      this.logger.warn(`Webhook con firma inválida para conexión ${connectionId}`);
      return { accepted: false };
    }

    for (const event of result.events) {
      await this.prisma.webhookEvent.create({
        data: {
          connectionId,
          provider: conn.provider,
          type: event.type,
          payload: JSON.parse(JSON.stringify(event.payload)),
        },
      });
    }

    // Sincronización dirigida en background (no bloquear la respuesta al proveedor)
    void this.sync.syncConnection(connectionId).catch((err) => this.logger.error(err.message));
    return { accepted: true };
  }
}
