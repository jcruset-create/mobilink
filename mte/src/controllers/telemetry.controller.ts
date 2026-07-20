import { Request, Response } from 'express';
import { PositionRepository } from '../repositories/position.repository';
import { TeltonikaTcpServer } from '../receivers/teltonika/teltonika-tcp.server';

export class TelemetryController {
  constructor(
    private readonly positions: PositionRepository,
    private readonly tcpServer: TeltonikaTcpServer,
  ) {}

  health = (_req: Request, res: Response): void => {
    res.json({
      status: 'ok',
      service: 'mte',
      connections: this.tcpServer.sessions.count,
      uptime: process.uptime(),
    });
  };

  currentPositions = async (req: Request, res: Response): Promise<void> => {
    const imei = typeof req.query.imei === 'string' ? req.query.imei : undefined;
    res.json(await this.positions.getCurrent(imei));
  };

  history = async (req: Request, res: Response): Promise<void> => {
    const { imei } = req.params;
    const from = typeof req.query.from === 'string' ? req.query.from : new Date(Date.now() - 86_400_000).toISOString();
    const to = typeof req.query.to === 'string' ? req.query.to : new Date().toISOString();
    res.json(await this.positions.getHistory(imei, from, to));
  };

  sessions = (_req: Request, res: Response): void => {
    res.json(
      this.tcpServer.sessions.list().map((s) => ({
        imei: s.imei,
        deviceType: s.deviceType,
        remoteAddress: s.remoteAddress,
        connectedAt: s.connectedAt,
        lastActivityAt: s.lastActivityAt,
        packetsReceived: s.packetsReceived,
        recordsReceived: s.recordsReceived,
      })),
    );
  };
}
