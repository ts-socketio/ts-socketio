# ts-socketio

TypeScript library providing end-to-end type safety for Socket.IO communication using Zod schemas for validation, based on a shared contract definition.

## Features

- **End-to-End Type Safety**: Strong TypeScript typings for Socket.IO clients and servers
- **Contract-Based API**: Define your API structure once, use it on both client and server
- **Runtime Validation**: Zod schemas ensure payloads and responses match at runtime
- **RPC-Style Interface**: Clean, intuitive API for emitting events and handling responses
- **Enhanced Decorators**: Streamlined NestJS integration with powerful decorators
- **Zero Config**: No code generation step required

## Packages

This monorepo contains the following packages:

- **@ts-socketio/core**: Core types, contract definition, and validation
- **@ts-socketio/client**: Type-safe Socket.IO client
- **@ts-socketio/server**: Type-safe Socket.IO server
- **@ts-socketio/nestjs**: NestJS integration with decorators and modules

## Installation

```bash
# Install packages
npm install @ts-socketio/core @ts-socketio/client
npm install @ts-socketio/server

# For NestJS integration
npm install @ts-socketio/nestjs
```

## Usage

### 1. Define a Contract

Create a shared contract using Zod schemas:

```typescript
import { defineSocketContract, z } from '@ts-socketio/core';

export const chatContract = defineSocketContract({
  // Client -> Server Events
  Client: {
    setNickname: {
      payload: z.object({ nickname: z.string() }),
      response: z.object({ success: z.boolean() })
    }
  },
  // Server -> Client Events
  Server: {
    userJoined: {
      payload: z.object({ userId: z.string(), nickname: z.string() })
    }
  },
  // Shared/Bidirectional Events
  sendMessage: {
    payload: z.object({ text: z.string() })
  }
});
```

### 2. Client Implementation

```typescript
import { createTypedSocketClient } from '@ts-socketio/client';
import { chatContract } from './contract';

const client = createTypedSocketClient(chatContract, 'http://localhost:3000');

// Type-safe emitters (with IntelliSense)
async function login() {
  // Typed payload, returns Promise<typed response>
  const response = await client.setNickname({ nickname: 'Alice' });
  console.log(response.success);
}

// Type-safe listeners
client.listeners.onUserJoined((payload) => {
  console.log(`${payload.nickname} joined`);
});

client.listeners.onSendMessage((payload) => {
  console.log(`New message: ${payload.text}`);
});
```

### 3. Server Implementation

```typescript
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createTypedSocketServer } from '@ts-socketio/server';
import { chatContract } from './contract';

const httpServer = createServer();
const io = new Server(httpServer);
const typedServer = createTypedSocketServer(io);

typedServer.registerContractHandlers(chatContract, (server) => {
  return {
    // Type-safe handler
    setNickname: ({ payload, socket }) => {
      const nickname = payload.nickname;
      console.log(`User ${socket.id} set nickname: ${nickname}`);
      
      // Broadcast with type-safety
      server.userJoined({ 
        userId: socket.id, 
        nickname 
      });
      
      // Type-safe response
      return { success: true };
    },
    
    sendMessage: ({ payload, socket }) => {
      // Broadcast message to all clients
      server.sendMessage({ text: payload.text });
    }
  };
});

httpServer.listen(3000);
```

### 4. NestJS Integration

```typescript
import { 
  WebSocketGateway, 
  WebSocketServer, 
  OnGatewayInit,
  OnGatewayConnection, 
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import {
  TypedServer,
  TsSocketHandler,
  TsMeta,
  tsParseServerEvents,
  TsSocketProvider
} from '@ts-socketio/nestjs';
import { chatContract } from './contract';

const { serverContract } = tsParseServerEvents(chatContract);

@WebSocketGateway()
export class ChatGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  @TypedServer(chatContract)
  typedServer;

  constructor(private readonly tsSocketProvider: TsSocketProvider) {}
  
  async afterInit() {
    // Register this gateway with the provider
    await this.tsSocketProvider.registerGateway(this);
  }

  // Full-featured handler example with all decorator types
  @TsSocketHandler(serverContract.setNickname)
  handleSetNickname(
    ctx, // Context with payload, socket, io
    @TsMeta() metadata, // Full metadata object
    @TsMeta('authToken') token, // Specific metadata field
    @ConnectedSocket() socket, // NestJS standard decorators still work
    @MessageBody() rawBody // Access raw message body if needed
  ) {
    // Implementation
    return { success: true };
  }
}

// Service-level access to emitters
import { Injectable } from '@nestjs/common';
import { TsSocketProvider } from '@ts-socketio/nestjs';

@Injectable()
export class ChatService {
  constructor(private readonly tsSocketProvider: TsSocketProvider) {}
  
  async sendSystemMessage(message: string) {
    // Get the emitter from the provider
    const emitter = await this.tsSocketProvider.getEmitter();
    
    // Use the emitter to broadcast messages from services
    emitter.sendMessage({ text: message, system: true });
  }
}

// In your module:
@Module({
  imports: [],
  providers: [ChatGateway, ChatService, TsSocketProvider]
})
export class AppModule {}
```
## NestJS Decorators and Providers Reference

The `@ts-socketio/nestjs` package provides several decorators and providers to integrate Socket.IO with NestJS in a type-safe manner:

| Name | Type | Description | Usage |
|------|------|-------------|-------|
| `@TypedServer()` | Decorator | Creates a typed emitter for server-to-client events based on the contract | `@TypedServer(contract) typedServer: TypedServerEmitter<Contract>;` |
| `@TsSocketHandler()` | Method Decorator | Registers an event handler with socket.io and handles validation | `@TsSocketHandler(serverContract.eventName) handleEvent(ctx) {}` |
| `@TsMeta()` | Parameter Decorator | Injects message metadata into handler parameters | `handleEvent(ctx, @TsMeta() metadata, @TsMeta('field') specificField) {}` |
| `TsSocketProvider` | Injectable Service | Provides access to typed emitters from any service | `constructor(private tsSocketProvider: TsSocketProvider) {}` |
| `TsSocketProvider.registerGateway()` | Method | Registers a gateway with the provider and waits for emitter to be available | `await tsSocketProvider.registerGateway(gateway, timeout?)` |
| `TsSocketProvider.getEmitter()` | Method | Gets the typed emitter for use in services | `const emitter = await tsSocketProvider.getEmitter()` |
| `tsParseServerEvents()` | Function | Processes a contract into server-side handlers | `const { serverContract } = tsParseServerEvents(contract);` |


## Examples

See the `/examples` directory for complete examples:

- **basic-chat**: A simple chat application demonstrating the core features
- **nestjs-chat**: A NestJS implementation of the chat example

## Development

```bash
# Clone the repository
git clone https://github.com/yourusername/ts-socketio.git
cd ts-socketio

# Install dependencies
yarn install

# Build all packages
yarn workspace @ts-socketio/core build
yarn workspace @ts-socketio/client build
yarn workspace @ts-socketio/server build
yarn workspace @ts-socketio/nestjs build

# Run examples
yarn workspace ts-socketio-example-basic-chat dev:server
yarn workspace ts-socketio-example-nestjs-chat start:dev
```

## License

MIT