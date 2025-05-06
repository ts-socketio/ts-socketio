import 'reflect-metadata'; // Required for metadata reflection
import { Server } from 'socket.io';
import {
    TypedSocketContract,
    InferPayload,
    EventDefinitions,
    EventDefinition,
    MessageEnvelope
} from '@ts-socketio/core';
import { ServerEmitterEvents, ServerEmitters, BroadcastOptions as ServerBroadcastOptions } from '@ts-socketio/server'; // Import server types
import { GATEWAY_SERVER_METADATA } from '@nestjs/websockets/constants';
import { gatewayEmitterCache } from './ts-socket-handler.decorator';

// Extend the BroadcastOptions interface to include additional properties needed for NestJS
interface BroadcastOptions extends ServerBroadcastOptions {
    target?: any; // Socket instance for direct emission
    only?: string[]; // List of socket IDs to emit to
    room?: string | string[];
}

// Key for storing metadata
export const TYPED_SERVER_PROPERTY_KEY = Symbol('ts-socketio:typed-server');
export const TYPED_SERVER_CONTRACT_KEY = Symbol('ts-socketio:typed-server-contract');

/**
 * Property Decorator to mark where the Typed Server Emitter should be injected.
 * The actual injection happens within the tsSocketioHandler or a base class.
 * 
 * @param contract - Optional contract to associate with this typed server instance
 */
export function TypedServer(contract?: TypedSocketContract): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    //Add a property to the class prototype
    (target as any)['_server'] = null;
    
    // Attach the metadata to the newly created property, to let
    // the nestjs/websockets module know that this is a socket
    Reflect.defineMetadata(GATEWAY_SERVER_METADATA, true, target, '_server');
    // Store metadata on the class prototype, associating the property key
    // with this decorator. The handler function will look for this.
    Reflect.defineMetadata(TYPED_SERVER_PROPERTY_KEY, propertyKey, target.constructor);
    
    // If contract is provided, also store it for later use
    if (contract) {
      Reflect.defineMetadata(TYPED_SERVER_CONTRACT_KEY, contract, target.constructor);
    }

    // Monkey patch the afterInit method to create the typed emitter
    const originalAfterInit = (target as any).afterInit;
    (target as any).afterInit = function (...args: any[]) {
      if (!this[propertyKey]) {
        const io = this._server;
        const contractMeta = contract || Reflect.getMetadata(TYPED_SERVER_CONTRACT_KEY, target.constructor);
        this[propertyKey] = createTypedServerEmitter(io, contractMeta);
        gatewayEmitterCache.set(this, this[propertyKey]); // <-- Store the emitter for this instance
      }
      if (typeof originalAfterInit === 'function') {
        return originalAfterInit.apply(this, args);
      }
    }
  };
}

/**
 * Internal helper function to create the typed emitter instance.
 * This might be called by the tsSocketioHandler.
 * 
 * @param io - The Socket.IO Server instance.
 * @param contract - The TypedSocketContract.
 * @returns A dynamically created object with type-safe emitter methods.
 */
export function createTypedServerEmitter<TContract extends TypedSocketContract>(
    io: Server,
    contract: TContract
): ServerEmitters<ServerEmitterEvents<TContract['definition']>> {
    const emitters: Partial<ServerEmitters<ServerEmitterEvents<TContract['definition']>>> = {};

    // Combine Server and Shared events for emission
    const serverEvents = contract.definition.Server ?? {};
    const sharedEvents: Record<string, EventDefinition> = {};
    for (const key in contract.definition) {
        if (key !== 'Client' && key !== 'Server' && Object.prototype.hasOwnProperty.call(contract.definition, key)) {
            const potentialEvent = contract.definition[key];
            if (potentialEvent && typeof potentialEvent === 'object' && ('payload' in potentialEvent || 'response' in potentialEvent)) {
                 sharedEvents[key] = potentialEvent as EventDefinition<any, any>;
            }
        }
    }

    const eventsToEmit: EventDefinitions = { ...serverEvents, ...sharedEvents };

    // Server metadata provider function
    let metadataProvider: ((eventName: string, payload: any, target?: any) => object) | undefined;

    // Add setMetadataProvider method to the emitters object
    (emitters as any).setMetadataProvider = (
        provider: (eventName: string, payload: any, target?: any) => object
    ) => {
        metadataProvider = provider;
    };

    for (const eventName in eventsToEmit) {
        if (Object.prototype.hasOwnProperty.call(eventsToEmit, eventName)) {
            const eventDef = eventsToEmit[eventName];
            if (!eventDef) continue;

            // Define the emitter function for this event
            (emitters as any)[eventName] = (
                payload: InferPayload<typeof eventDef>,
                options?: BroadcastOptions
            ) => {
                // Validate payload if schema exists
                if (eventDef.payload) {
                    try {
                        payload = eventDef.payload.parse(payload);
                    } catch (error) {
                        console.error(`[ts-socketio/nestjs] Payload validation failed for emission of '${eventName}':`, error);
                        throw error;
                    }
                }

                // Create base metadata
                const baseMetadata = {
                    messageId: `server-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                    serverTimestamp: Date.now()
                };

                // Get custom metadata if provider exists
                const customMetadata = metadataProvider
                    ? metadataProvider(eventName, payload, options?.target)
                    : {};

                // Create envelope
                const envelope: MessageEnvelope<typeof payload, typeof baseMetadata & typeof customMetadata> = {
                    payload,
                    metadata: {
                        ...baseMetadata,
                        ...customMetadata
                    }
                };

                // Handle broadcast options
                if (options) {
                  if (options.room) {
                    // Send to specific room(s)
                    if (Array.isArray(options.room)) {
                        options.room.forEach(room => {
                            io.to(room).emit(eventName, envelope);
                        });
                    } else {
                        io.to(options.room).emit(eventName, envelope);
                    }
                  } else if (options.except && Array.isArray(options.except)) {
                        // Broadcast to all except the specified IDs
                        for (const socketId of options.except) {
                            io.sockets.sockets.forEach((socket) => {
                                if (socket.id !== socketId) {
                                    socket.emit(eventName, envelope);
                                }
                            });
                        }
                    } else if (options.only && Array.isArray(options.only)) {
                        // Broadcast only to the specified IDs
                        for (const socketId of options.only) {
                            const socket = io.sockets.sockets.get(socketId);
                            if (socket) {
                                socket.emit(eventName, envelope);
                            }
                        }
                    } else if (options.target) {
                        // Send to a specific socket
                        options.target.emit(eventName, envelope);
                    } else {
                        // Default: broadcast to all
                        io.emit(eventName, envelope);
                    }
                } else {
                    // Default: broadcast to all
                    io.emit(eventName, envelope);
                }
            };
        }
    }

    return emitters as ServerEmitters<ServerEmitterEvents<TContract['definition']>>;
}
