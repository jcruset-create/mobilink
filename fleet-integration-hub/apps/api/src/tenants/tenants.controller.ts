import { Body, Controller, Get, Post } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('api/v1/tenants')
export class TenantsController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  create(@Body() body: { name: string }) {
    return this.prisma.tenant.create({ data: { name: body.name } });
  }

  @Get()
  list() {
    return this.prisma.tenant.findMany({ where: { active: true } });
  }
}
