import { Injectable, Logger } from '@nestjs/common';
import { ProviderCredentials } from '@fih/domain';
import { getAdapter } from '@fih/adapters';
import { PrismaService } from '../prisma/prisma.service';
import { decryptJson, encryptJson } from '../common/crypto.util';

/**
 * Gestión centralizada de credenciales y renovación de tokens.
 * - Descifra credenciales de la conexión
 * - Si el accessToken caduca en < 5 min, delega en adapter.authenticate()
 *   (que ejecuta el refresh flow del proveedor) y persiste el resultado cifrado
 */
@Injectable()
export class TokenManagerService {
  private readonly logger = new Logger(TokenManagerService.name);
  private static readonly REFRESH_MARGIN_MS = 5 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  async getFreshCredentials(connectionId: string): Promise<ProviderCredentials> {
    const conn = await this.prisma.providerConnection.findUniqueOrThrow({ where: { id: connectionId } });
    let credentials = decryptJson<ProviderCredentials>(conn.credentialsEncrypted);

    const needsRefresh =
      credentials.expiresAt !== undefined &&
      credentials.expiresAt - Date.now() < TokenManagerService.REFRESH_MARGIN_MS;

    if (needsRefresh) {
      this.logger.log(`Renovando token de ${conn.provider} (conexión ${conn.id})`);
      const adapter = getAdapter(conn.provider);
      try {
        credentials = await adapter.authenticate(credentials);
        await this.prisma.providerConnection.update({
          where: { id: conn.id },
          data: { credentialsEncrypted: encryptJson(credentials), status: 'active' },
        });
      } catch (err) {
        await this.prisma.providerConnection.update({
          where: { id: conn.id },
          data: { status: 'auth_error' },
        });
        throw err;
      }
    }
    return credentials;
  }

  async storeCredentials(connectionId: string, credentials: ProviderCredentials): Promise<void> {
    await this.prisma.providerConnection.update({
      where: { id: connectionId },
      data: { credentialsEncrypted: encryptJson(credentials) },
    });
  }
}
