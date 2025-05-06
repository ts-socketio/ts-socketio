import { Injectable, Logger } from '@nestjs/common';
import { gatewayEmitterCache } from './decorators/ts-socket-handler.decorator';
import { inspect } from 'util';
import { NestGateway } from '@nestjs/websockets/interfaces/nest-gateway.interface';
// Logger for this file
const logger = new Logger('ts-socketio/nestjs/TsSocketProvider');

@Injectable()
export class TsSocketProvider {
  
  private emitterPromise: Promise<any>;
  private resolveEmitter!: (emitter: any) => void;

  constructor() {
    // Promise that resolves when the emitter is ready
    this.emitterPromise = new Promise(resolve => {
      this.resolveEmitter = resolve;
    });
  }

    async registerGateway(gateway: NestGateway, timeout = 5000): Promise<any> {
    logger.debug(`Registering gateway: ${gateway.constructor.name}`);
    const start = Date.now();
    const waitForEmitter = (): Promise<any> =>
      new Promise((resolve, reject) => {
        const check = () => {
          const emitter = gatewayEmitterCache.get(gateway);
          if (emitter) {
            logger.verbose(`Cached emitter: ${inspect(emitter)}`);
            this.resolveEmitter(emitter);
            //add 1ms delay to ensure the emitter is registered
            setTimeout(() => {
              resolve(emitter);
            }, 1);
          } else if (Date.now() - start > timeout) {
            logger.warn('Timeout waiting for emitter in registerGateway');
            reject(new Error('Emitter not found in cache within timeout'));
          } else {
            setTimeout(check, 10);
          }
        };
        check();
      });
  
    return waitForEmitter();
  }
  
  getEmitter() : Promise<any> {
    return this.emitterPromise;
  }
}