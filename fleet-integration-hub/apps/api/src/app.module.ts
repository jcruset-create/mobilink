import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaService } from './prisma/prisma.service';
import { TokenManagerService } from './connections/token-manager.service';
import { ConnectionsController } from './connections/connections.controller';
import { TenantsController } from './tenants/tenants.controller';
import { SyncService } from './sync/sync.service';
import { SyncScheduler } from './sync/sync.scheduler';
import { WebhooksController } from './webhooks/webhooks.controller';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [ConnectionsController, TenantsController, WebhooksController],
  providers: [PrismaService, TokenManagerService, SyncService, SyncScheduler],
})
export class AppModule {}
