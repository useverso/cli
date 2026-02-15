import type { VersoConfig, DoctorCheck } from '../../types/index.js';
import type { BoardIntegration, BoardItem } from './interface.js';

export class LinearIntegration implements BoardIntegration {
  name = 'linear';

  async setup(_projectRoot: string, _config: VersoConfig): Promise<void> {
    throw new Error('Linear integration coming soon');
  }

  async validate(_projectRoot: string, _config: VersoConfig): Promise<DoctorCheck[]> {
    return [{ name: 'Linear integration', severity: 'warn', message: 'Linear integration not yet available' }];
  }

  async sync(_projectRoot: string, board: BoardItem[]): Promise<BoardItem[]> {
    throw new Error('Linear integration coming soon');
  }

  getStatusInfo(_config: VersoConfig): Record<string, string> {
    return { provider: 'linear', status: 'Not yet available' };
  }
}
